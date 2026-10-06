CREATE OR REPLACE FUNCTION validate_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.order_item_id,NEW.order_id,NEW.ticket_type_id,NEW.quantity,NEW.created_at) IS DISTINCT FROM ROW(OLD.order_item_id,OLD.order_id,OLD.ticket_type_id,OLD.quantity,OLD.created_at)
      OR (OLD.state='committed' AND NEW.state<>OLD.state)
      OR (OLD.state='released' AND NEW.state NOT IN ('released','committed')) THEN
      RAISE EXCEPTION 'Reservation identity or terminal state is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.state='committed' AND NOT EXISTS (SELECT 1 FROM orders o JOIN payment_fulfillments f ON f.order_id=o.id WHERE o.id=NEW.order_id AND o.status='paid') THEN
      RAISE EXCEPTION 'Committed inventory requires confirmed fulfillment' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' AND (NEW.state<>'held' OR NOT EXISTS (SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.id=NEW.order_item_id AND i.order_id=NEW.order_id AND i.ticket_type_id=NEW.ticket_type_id AND i.quantity=NEW.quantity AND o.status='pending')) THEN
    RAISE EXCEPTION 'Reservation must match a pending order item' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION protect_payment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.order_id,NEW.provider,NEW.provider_reference,NEW.expected_amount,NEW.currency,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.provider,OLD.provider_reference,OLD.expected_amount,OLD.currency,OLD.created_at)
    OR (OLD.status='succeeded' AND ROW(NEW.status,NEW.verified_amount,NEW.verified_currency,NEW.verified_at) IS DISTINCT FROM ROW(OLD.status,OLD.verified_amount,OLD.verified_currency,OLD.verified_at)) THEN
    RAISE EXCEPTION 'Payment identity and successful verification are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_history_guard BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION protect_payment_history();
--> statement-breakpoint
CREATE FUNCTION validate_payment_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payments p WHERE p.id=NEW.payment_id AND p.order_id=NEW.order_id AND p.status='succeeded') THEN
    RAISE EXCEPTION 'Fulfillment requires a matching verified payment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_fulfillment_guard BEFORE INSERT ON payment_fulfillments FOR EACH ROW EXECUTE FUNCTION validate_payment_fulfillment();
--> statement-breakpoint
CREATE FUNCTION preserve_paid_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('paid','refunded','partially_refunded') AND NEW.status NOT IN ('paid','refunded','partially_refunded') THEN
    RAISE EXCEPTION 'Paid order cannot regress to unpaid' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER paid_status_guard BEFORE UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION preserve_paid_status();
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT provider_fees_bounds CHECK (provider_fees IS NULL OR (provider_fees>=0 AND provider_fees<=expected_amount));
--> statement-breakpoint
INSERT INTO payment_jobs (payment_id) SELECT id FROM payments WHERE status IN ('initialized','pending','failed') ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ticketsquare_app') THEN
    GRANT SELECT,INSERT,UPDATE ON payment_jobs TO ticketsquare_app;
    GRANT SELECT,INSERT ON payment_webhook_receipts,payment_fulfillments,payment_exceptions TO ticketsquare_app;
    REVOKE UPDATE,DELETE ON payment_webhook_receipts,payment_fulfillments,payment_exceptions FROM ticketsquare_app;
    REVOKE DELETE ON payment_jobs FROM ticketsquare_app;
  END IF;
END $$;
