CREATE TABLE "ticket_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"ciphertext" text NOT NULL,
	"key_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_access_grants_job_id_unique" UNIQUE("job_id"),
	CONSTRAINT "ticket_access_grants_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "access_hash" CHECK ("ticket_access_grants"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "access_expiry" CHECK ("ticket_access_grants"."expires_at" > "ticket_access_grants"."created_at")
);
--> statement-breakpoint
CREATE TABLE "ticket_access_sessions" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_session_hash" CHECK ("ticket_access_sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "access_session_expiry" CHECK ("ticket_access_sessions"."expires_at" > "ticket_access_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "ticket_delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"business_key" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_delivery_jobs_business_key_unique" UNIQUE("business_key"),
	CONSTRAINT "delivery_state" CHECK ("ticket_delivery_jobs"."state" IN ('pending','done','attention')),
	CONSTRAINT "delivery_attempts" CHECK ("ticket_delivery_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ticket_access_grants" ADD CONSTRAINT "ticket_access_grants_job_id_ticket_delivery_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ticket_delivery_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_access_grants" ADD CONSTRAINT "ticket_access_grants_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_access_sessions" ADD CONSTRAINT "ticket_access_sessions_grant_id_ticket_access_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."ticket_access_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_delivery_jobs" ADD CONSTRAINT "ticket_delivery_jobs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_delivery_due" ON "ticket_delivery_jobs" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE FUNCTION preserve_delivery_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.order_id,NEW.business_key,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.business_key,OLD.created_at) THEN
    RAISE EXCEPTION 'Delivery identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER delivery_identity_guard BEFORE UPDATE ON ticket_delivery_jobs FOR EACH ROW EXECUTE FUNCTION preserve_delivery_identity();
--> statement-breakpoint
CREATE FUNCTION validate_access_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM ticket_delivery_jobs WHERE id=NEW.job_id AND order_id=NEW.order_id) THEN
      RAISE EXCEPTION 'Access grant scope mismatch' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.job_id,NEW.order_id,NEW.token_hash,NEW.ciphertext,NEW.key_id,NEW.expires_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.job_id,OLD.order_id,OLD.token_hash,OLD.ciphertext,OLD.key_id,OLD.expires_at,OLD.created_at)
      OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
      RAISE EXCEPTION 'Access grant identity and terminal state are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_grant_guard BEFORE INSERT OR UPDATE ON ticket_access_grants FOR EACH ROW EXECUTE FUNCTION validate_access_grant();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ticketsquare_app') THEN
    GRANT SELECT,INSERT,UPDATE ON ticket_delivery_jobs,ticket_access_grants TO ticketsquare_app;
    GRANT SELECT,INSERT ON ticket_access_sessions TO ticketsquare_app;
    REVOKE UPDATE,DELETE ON ticket_access_sessions FROM ticketsquare_app;
    REVOKE DELETE ON ticket_delivery_jobs,ticket_access_grants FROM ticketsquare_app;
  END IF;
END $$;
