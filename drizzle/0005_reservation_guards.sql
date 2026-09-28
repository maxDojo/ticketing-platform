CREATE FUNCTION validate_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (ROW(NEW.order_item_id,NEW.order_id,NEW.ticket_type_id,NEW.quantity,NEW.created_at) IS DISTINCT FROM ROW(OLD.order_item_id,OLD.order_id,OLD.ticket_type_id,OLD.quantity,OLD.created_at)
    OR (OLD.state <> 'held' AND NEW.state <> OLD.state)) THEN
    RAISE EXCEPTION 'Reservation identity or terminal state is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.state <> 'held' OR NOT EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE i.id=NEW.order_item_id AND i.order_id=NEW.order_id AND i.ticket_type_id=NEW.ticket_type_id AND i.quantity=NEW.quantity AND o.status='pending'
  )) THEN
    RAISE EXCEPTION 'Reservation must match a pending order item' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER reservation_guard BEFORE INSERT OR UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION validate_reservation();
--> statement-breakpoint
CREATE FUNCTION preserve_checkout_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Checkout identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER checkout_request_guard BEFORE UPDATE ON checkout_requests FOR EACH ROW EXECUTE FUNCTION preserve_checkout_request();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ticketsquare_app') THEN
    GRANT SELECT,INSERT,UPDATE ON reservations TO ticketsquare_app;
    GRANT SELECT,INSERT ON checkout_requests TO ticketsquare_app;
    REVOKE UPDATE,DELETE ON checkout_requests FROM ticketsquare_app;
    REVOKE DELETE ON reservations FROM ticketsquare_app;
  END IF;
END $$;
