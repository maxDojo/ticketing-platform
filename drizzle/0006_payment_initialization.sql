CREATE TABLE "payment_initializations" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"state" text DEFAULT 'initializing' NOT NULL,
	"authorization_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_initializations_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "payment_initialization_state" CHECK ("payment_initializations"."state" in ('initializing','ready','unknown')),
	CONSTRAINT "payment_initialization_url" CHECK (("payment_initializations"."state" = 'ready') = ("payment_initializations"."authorization_url" is not null))
);
--> statement-breakpoint
ALTER TABLE "payment_initializations" ADD CONSTRAINT "payment_initializations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_initializations" ADD CONSTRAINT "payment_initializations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;