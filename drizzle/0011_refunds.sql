CREATE TABLE "event_cancellations" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_reason" CHECK (char_length("event_cancellations"."reason") BETWEEN 5 AND 200)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'approved' NOT NULL,
	"provider_id" text,
	"provider_status" text,
	"dispatch_started_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "refunds_provider_id_unique" UNIQUE("provider_id"),
	CONSTRAINT "refund_amount" CHECK ("refunds"."amount">0),
	CONSTRAINT "refund_kind" CHECK ("refunds"."kind" IN ('fulfilled','excess','unfulfilled')),
	CONSTRAINT "refund_state" CHECK ("refunds"."state" IN ('approved','processing','attention','processed')),
	CONSTRAINT "refund_reason" CHECK (char_length("refunds"."reason") BETWEEN 5 AND 200),
	CONSTRAINT "refund_attempts" CHECK ("refunds"."attempts">=0),
	CONSTRAINT "refund_processed" CHECK (("refunds"."state"='processed')=("refunds"."processed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "event_cancellations" ADD CONSTRAINT "event_cancellations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cancellations" ADD CONSTRAINT "event_cancellations_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_due" ON "refunds" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "refunds_event" ON "refunds" USING btree ("event_id");
--> statement-breakpoint
CREATE FUNCTION validate_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW.payment_id,NEW.order_id,NEW.event_id,NEW.actor_id,NEW.amount,NEW.currency,NEW.kind,NEW.reason,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.payment_id,OLD.order_id,OLD.event_id,OLD.actor_id,OLD.amount,OLD.currency,OLD.kind,OLD.reason,OLD.created_at)
   OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
   OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id)
   OR (OLD.state='processed' AND NEW IS DISTINCT FROM OLD) THEN
   RAISE EXCEPTION 'Refund history is immutable' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM payments p JOIN orders o ON o.id=p.order_id JOIN events e ON e.id=o.event_id JOIN organizers a ON a.user_id=e.organizer_id
   WHERE p.id=NEW.payment_id AND o.id=NEW.order_id AND e.id=NEW.event_id AND a.user_id=NEW.actor_id AND a.active AND p.status='succeeded' AND p.verified_amount=NEW.amount AND p.verified_currency=NEW.currency) THEN
   RAISE EXCEPTION 'Refund scope mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.kind IS DISTINCT FROM (SELECT CASE WHEN f.payment_id=NEW.payment_id THEN 'fulfilled' ELSE 'excess' END FROM payment_fulfillments f WHERE f.order_id=NEW.order_id) AND NOT (NEW.kind='unfulfilled' AND NOT EXISTS(SELECT 1 FROM payment_fulfillments WHERE order_id=NEW.order_id)) THEN
   RAISE EXCEPTION 'Refund kind mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='fulfilled' AND EXISTS(SELECT 1 FROM tickets t LEFT JOIN check_ins c ON c.ticket_id=t.id WHERE t.order_id=NEW.order_id AND (t.status='valid' OR c.id IS NOT NULL)) THEN
   RAISE EXCEPTION 'Refund admissions must be blocked and unused' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_guard BEFORE INSERT OR UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION validate_refund();
--> statement-breakpoint
CREATE FUNCTION prevent_refund_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='valid' AND EXISTS(SELECT 1 FROM refunds WHERE order_id=NEW.order_id AND kind='fulfilled') THEN
  RAISE EXCEPTION 'Refund admissions cannot be restored' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_admission_guard BEFORE INSERT OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION prevent_refund_admission();
--> statement-breakpoint
CREATE FUNCTION prevent_event_reopening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='cancelled' AND NEW.status<>'cancelled' THEN
  RAISE EXCEPTION 'Cancelled events cannot be reopened' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cancelled_event_guard BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION prevent_event_reopening();
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ticketsquare_app') THEN
  GRANT SELECT,INSERT,UPDATE ON refunds TO ticketsquare_app;
  REVOKE DELETE ON refunds FROM ticketsquare_app;
  GRANT SELECT,INSERT ON event_cancellations TO ticketsquare_app;
  REVOKE UPDATE,DELETE ON event_cancellations FROM ticketsquare_app;
 END IF;
END $$;
