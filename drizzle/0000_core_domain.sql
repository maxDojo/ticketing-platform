CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'expired', 'paid', 'cancelled', 'payment_exception', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initialized', 'pending', 'failed', 'succeeded', 'mismatched');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('valid', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"venue" text NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"reservation_minutes" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "event_slug_format" CHECK ("events"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "event_name_present" CHECK (length(trim("events"."name")) > 0),
	CONSTRAINT "event_venue_present" CHECK (length(trim("events"."venue")) > 0),
	CONSTRAINT "event_reservation_bounds" CHECK ("events"."reservation_minutes" between 1 and 1440),
	CONSTRAINT "event_dates" CHECK ("events"."ends_at" is null or "events"."ends_at" > "events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"currency" varchar(3) NOT NULL,
	"ticket_type_name" varchar(200) NOT NULL,
	"unit_price" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"admissions_per_unit" integer NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_order_event" UNIQUE("id","order_id","event_id"),
	CONSTRAINT "item_type_per_order" UNIQUE("order_id","ticket_type_id"),
	CONSTRAINT "item_quantities" CHECK ("order_items"."quantity" > 0 and "order_items"."admissions_per_unit" > 0),
	CONSTRAINT "item_name_present" CHECK (length(trim("order_items"."ticket_type_name")) > 0),
	CONSTRAINT "item_amounts" CHECK ("order_items"."unit_price" >= 0 and "order_items"."subtotal" = "order_items"."unit_price" * "order_items"."quantity" and "order_items"."discount" >= 0 and "order_items"."discount" <= "order_items"."subtotal")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(100) NOT NULL,
	"event_id" uuid NOT NULL,
	"buyer_name" varchar(200) NOT NULL,
	"buyer_email" varchar(320) NOT NULL,
	"buyer_phone" varchar(32),
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"subtotal" bigint NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"fees" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"reservation_minutes" integer NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_reference_unique" UNIQUE("reference"),
	CONSTRAINT "order_event_currency" UNIQUE("id","event_id","currency"),
	CONSTRAINT "order_payment_amount" UNIQUE("id","currency","total"),
	CONSTRAINT "order_buyer_present" CHECK (length(trim("orders"."buyer_name")) > 0 and length(trim("orders"."buyer_email")) > 0),
	CONSTRAINT "order_reference_present" CHECK (length(trim("orders"."reference")) > 0),
	CONSTRAINT "order_currency" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "order_amounts" CHECK ("orders"."subtotal" >= 0 and "orders"."discount" >= 0 and "orders"."discount" <= "orders"."subtotal" and "orders"."fees" >= 0 and "orders"."total" = "orders"."subtotal" - "orders"."discount" + "orders"."fees"),
	CONSTRAINT "order_reservation_bounds" CHECK ("orders"."reservation_minutes" between 1 and 1440),
	CONSTRAINT "order_reservation_expiry" CHECK ("orders"."reservation_expires_at" = "orders"."reserved_at" + "orders"."reservation_minutes" * interval '1 minute')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"provider_reference" varchar(100) NOT NULL,
	"expected_amount" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"verified_amount" bigint,
	"verified_currency" varchar(3),
	"verified_at" timestamp with time zone,
	"status" "payment_status" DEFAULT 'initialized' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_reference_unique" UNIQUE("provider_reference"),
	CONSTRAINT "payment_provider" CHECK ("payments"."provider" = 'paystack'),
	CONSTRAINT "payment_reference_present" CHECK (length(trim("payments"."provider_reference")) > 0),
	CONSTRAINT "payment_amounts" CHECK ("payments"."expected_amount" >= 0 and ("payments"."verified_amount" is null or "payments"."verified_amount" >= 0)),
	CONSTRAINT "payment_success_verified" CHECK ("payments"."status" <> 'succeeded' or ("payments"."verified_at" is not null and "payments"."verified_amount" is not null and "payments"."verified_currency" is not null and "payments"."verified_amount" = "payments"."expected_amount" and "payments"."verified_currency" = "payments"."currency"))
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"unit_price" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"capacity" integer NOT NULL,
	"reserved_units" integer DEFAULT 0 NOT NULL,
	"sold_units" integer DEFAULT 0 NOT NULL,
	"admissions_per_unit" integer DEFAULT 1 NOT NULL,
	"minimum_quantity" integer DEFAULT 1 NOT NULL,
	"maximum_quantity" integer DEFAULT 10 NOT NULL,
	"sale_starts_at" timestamp with time zone,
	"sale_ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_type_event_currency" UNIQUE("id","event_id","currency"),
	CONSTRAINT "ticket_type_name_present" CHECK (length(trim("ticket_types"."name")) > 0),
	CONSTRAINT "ticket_type_price" CHECK ("ticket_types"."unit_price" >= 0),
	CONSTRAINT "ticket_type_currency" CHECK ("ticket_types"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ticket_type_inventory" CHECK ("ticket_types"."capacity" >= 0 and "ticket_types"."reserved_units" >= 0 and "ticket_types"."sold_units" >= 0 and "ticket_types"."reserved_units"::bigint + "ticket_types"."sold_units"::bigint <= "ticket_types"."capacity"),
	CONSTRAINT "ticket_type_admissions" CHECK ("ticket_types"."admissions_per_unit" > 0),
	CONSTRAINT "ticket_type_quantities" CHECK ("ticket_types"."minimum_quantity" > 0 and "ticket_types"."maximum_quantity" >= "ticket_types"."minimum_quantity"),
	CONSTRAINT "ticket_type_sale_dates" CHECK ("ticket_types"."sale_ends_at" is null or "ticket_types"."sale_starts_at" is null or "ticket_types"."sale_ends_at" > "ticket_types"."sale_starts_at")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(100) NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"admission_ordinal" integer NOT NULL,
	"attendee_name" varchar(200),
	"status" "ticket_status" DEFAULT 'valid' NOT NULL,
	"credential_hash" varchar(64) NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"credential_key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_reference_unique" UNIQUE("reference"),
	CONSTRAINT "tickets_credential_hash_unique" UNIQUE("credential_hash"),
	CONSTRAINT "ticket_admission_once" UNIQUE("order_item_id","admission_ordinal"),
	CONSTRAINT "ticket_admission_positive" CHECK ("tickets"."admission_ordinal" > 0),
	CONSTRAINT "ticket_reference_present" CHECK (length(trim("tickets"."reference")) > 0),
	CONSTRAINT "ticket_credential_hash" CHECK ("tickets"."credential_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ticket_credential_material" CHECK (length(trim("tickets"."credential_ciphertext")) > 0 and length(trim("tickets"."credential_key_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "item_order_scope" FOREIGN KEY ("order_id","event_id","currency") REFERENCES "public"."orders"("id","event_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "item_type_scope" FOREIGN KEY ("ticket_type_id","event_id","currency") REFERENCES "public"."ticket_types"("id","event_id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payment_order_amount" FOREIGN KEY ("order_id","currency","expected_amount") REFERENCES "public"."orders"("id","currency","total") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "ticket_item_scope" FOREIGN KEY ("order_item_id","order_id","event_id") REFERENCES "public"."order_items"("id","order_id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_type_idx" ON "order_items" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE INDEX "orders_event_created_idx" ON "orders" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_expiry_idx" ON "orders" USING btree ("reservation_expires_at") WHERE "orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "ticket_types_event_idx" ON "ticket_types" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_event_idx" ON "tickets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "tickets_order_idx" ON "tickets" USING btree ("order_id");