CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"method" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_ins_ticket_id_unique" UNIQUE("ticket_id"),
	CONSTRAINT "check_in_method" CHECK ("check_ins"."method" IN ('qr','manual')),
	CONSTRAINT "check_in_reason" CHECK (("check_ins"."method"='qr' AND "check_ins"."reason" IS NULL) OR ("check_ins"."method"='manual' AND char_length("check_ins"."reason") BETWEEN 5 AND 200 AND "check_ins"."reason" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "event_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_staff_membership" UNIQUE("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_staff" ADD CONSTRAINT "event_staff_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_ins_event" ON "check_ins" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "event_staff_user" ON "event_staff" USING btree ("user_id");--> statement-breakpoint
CREATE FUNCTION validate_check_in() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets t JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=t.event_id
    WHERE t.id=NEW.ticket_id AND t.event_id=NEW.event_id AND t.status='valid' AND o.status IN ('paid','partially_refunded') AND e.status='published') THEN
    RAISE EXCEPTION 'Admission unavailable or event mismatch' USING ERRCODE='23514';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER check_in_guard BEFORE INSERT ON check_ins FOR EACH ROW EXECUTE FUNCTION validate_check_in();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ticketsquare_app') THEN
    GRANT SELECT ON event_staff TO ticketsquare_app;
    REVOKE INSERT,UPDATE,DELETE ON event_staff FROM ticketsquare_app;
    GRANT SELECT,INSERT ON check_ins TO ticketsquare_app;
    REVOKE UPDATE,DELETE ON check_ins FROM ticketsquare_app;
  END IF;
END $$;
