-- These cross-table and historical invariants require triggers, not CHECK constraints.
CREATE FUNCTION validate_event_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown event timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER event_timezone_guard BEFORE INSERT OR UPDATE OF timezone ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_timezone();
--> statement-breakpoint
CREATE FUNCTION capture_order_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT reservation_minutes INTO NEW.reservation_minutes FROM events WHERE id = NEW.event_id FOR SHARE;
  NEW.reserved_at := clock_timestamp();
  NEW.reservation_expires_at := NEW.reserved_at + NEW.reservation_minutes * interval '1 minute';
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_reservation_snapshot BEFORE INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION capture_order_reservation();
--> statement-breakpoint
CREATE FUNCTION preserve_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.reference, NEW.event_id, NEW.currency, NEW.subtotal, NEW.discount, NEW.fees, NEW.total, NEW.reservation_minutes, NEW.reserved_at, NEW.reservation_expires_at, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.reference, OLD.event_id, OLD.currency, OLD.subtotal, OLD.discount, OLD.fees, OLD.total, OLD.reservation_minutes, OLD.reserved_at, OLD.reservation_expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'Order commercial snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER order_snapshot_guard BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION preserve_order_snapshot();
--> statement-breakpoint
CREATE FUNCTION preserve_order_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Order item snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER item_snapshot_guard BEFORE UPDATE ON order_items
FOR EACH ROW EXECUTE FUNCTION preserve_order_item();
--> statement-breakpoint
CREATE FUNCTION validate_ticket_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status order_status;
  admission_limit bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.order_id, NEW.order_item_id, NEW.event_id, NEW.admission_ordinal, NEW.reference, NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.order_id, OLD.order_item_id, OLD.event_id, OLD.admission_ordinal, OLD.reference, OLD.created_at) THEN
      RAISE EXCEPTION 'Admission identity is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO parent_status FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'paid'::order_status THEN
    RAISE EXCEPTION 'Tickets require a paid order' USING ERRCODE = '23514';
  END IF;
  SELECT quantity::bigint * admissions_per_unit::bigint INTO admission_limit
    FROM order_items WHERE id = NEW.order_item_id AND order_id = NEW.order_id AND event_id = NEW.event_id;
  IF admission_limit IS NULL OR NEW.admission_ordinal < 1 OR NEW.admission_ordinal > admission_limit THEN
    RAISE EXCEPTION 'Admission outside purchased quantity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ticket_admission_guard BEFORE INSERT OR UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION validate_ticket_admission();
