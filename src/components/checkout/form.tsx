"use client";
import { useEffect, useState, type FormEvent } from "react";
import { formatMoney } from "@/modules/events/validation";
type TicketOption = {
  id: string;
  name: string;
  price: string;
  admissions: number;
  minimum: number;
  maximum: number;
  available: boolean;
};
type Summary = {
  id: string;
  reference: string;
  status: string;
  total: string;
  currency: string;
  reservation_expires_at: string;
  server_now: string;
  items: {
    name: string;
    quantity: number;
    admissions_per_unit: number;
    unit_price: string;
    subtotal: string;
  }[];
};
async function call(path: string, body?: unknown): Promise<Summary> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "Unable to complete checkout. Please retry.");
  return data;
}
export function CheckoutForm({
  eventId,
  types,
}: {
  eventId: string;
  types: TicketOption[];
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const storageKey = `ts-checkout:${eventId}`;
  const total = types.reduce(
    (sum, t) => sum + BigInt(t.price) * BigInt(quantities[t.id] || 0),
    0n,
  );
  useEffect(() => {
    // Only opaque references and a request digest are kept in session storage.
    Promise.resolve().then(async () => {
      try {
        const id = sessionStorage.getItem(`${storageKey}:order`);
        if (id) setOrder(await call(`/api/orders/${id}`));
      } catch {
        setRestoreFailed(true);
        setError(
          "Your previous reservation could not be loaded. Retry before starting another. Browser access lasts 24 hours.",
        );
      } finally {
        setRestoring(false);
      }
    });
  }, [storageKey]);
  useEffect(() => {
    if (!order || order.status !== "pending") return;
    const deadline =
      Date.parse(order.reservation_expires_at) - Date.parse(order.server_now);
    const start = performance.now();
    const tick = () =>
      setRemaining(
        Math.max(0, Math.ceil((deadline - (performance.now() - start)) / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    // Refresh to confirm the server's state at expiry; the browser never releases stock itself.
    const refresh = setTimeout(
      () => {
        call(`/api/orders/${order.id}`)
          .then(setOrder)
          .catch(() =>
            setError("The hold time has ended. Refresh to confirm its status."),
          );
      },
      Math.max(0, deadline) + 250,
    );
    return () => {
      clearInterval(timer);
      clearTimeout(refresh);
    };
  }, [order]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const items = types
        .filter((t) => (quantities[t.id] ?? 0) > 0)
        .map((t) => ({ ticketTypeId: t.id, quantity: quantities[t.id] }))
        .sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
      if (!items.length)
        throw new Error("Choose at least one ticket category.");
      const details = {
        eventId,
        buyerName: String(form.get("name")).trim(),
        buyerEmail: String(form.get("email")).trim().toLowerCase(),
        buyerPhone: String(form.get("phone")).trim(),
        items,
      };
      const fingerprint = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(details)),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const prior = sessionStorage.getItem(storageKey);
      const saved = prior
        ? (JSON.parse(prior) as { fingerprint: string; key: string })
        : null;
      const key =
        saved?.fingerprint === fingerprint ? saved.key : crypto.randomUUID();
      sessionStorage.setItem(storageKey, JSON.stringify({ fingerprint, key }));
      await call("/api/checkout/session", {});
      const result = await call("/api/orders", { ...details, requestKey: key });
      sessionStorage.setItem(`${storageKey}:order`, result.id);
      setOrder(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      setOrder(await call(`/api/orders/${order!.id}/cancel`, {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  if (restoring) return <p>Loading your reservation…</p>;
  if (restoreFailed)
    return (
      <div className="stack">
        <p role="alert">{error}</p>
        <button className="button" onClick={() => window.location.reload()}>
          Retry loading reservation
        </button>
      </div>
    );
  return (
    <div className="stack">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {order ? (
        <section className="panel stack">
          <h2>
            {order.status === "pending"
              ? "Tickets reserved"
              : order.status === "expired"
                ? "Reservation expired"
                : order.status === "cancelled"
                  ? "Reservation cancelled"
                  : "Order status"}
          </h2>
          <p>Reference: {order.reference}</p>
          {order.status === "pending" && (
            <p role="timer">
              Time remaining: {Math.floor(remaining / 60)}:
              {String(remaining % 60).padStart(2, "0")}
            </p>
          )}
          {order.items.map((i, index) => (
            <div key={index}>
              <strong>
                {i.quantity} × {i.name}
              </strong>
              <p>
                {formatMoney(BigInt(i.subtotal))} ·{" "}
                {i.quantity * i.admissions_per_unit} separate admission(s)
              </p>
            </div>
          ))}
          <p className="price">Total: {formatMoney(BigInt(order.total))}</p>
          <p>No payment has been taken and no tickets have been issued.</p>
          {order.status === "pending" ? (
            <button
              className="button secondary"
              disabled={busy}
              onClick={cancel}
            >
              Cancel reservation
            </button>
          ) : (
            <button
              className="button"
              onClick={() => {
                sessionStorage.removeItem(storageKey);
                sessionStorage.removeItem(`${storageKey}:order`);
                window.location.reload();
              }}
            >
              Choose tickets again
            </button>
          )}
        </section>
      ) : (
        <form onSubmit={submit} className="public-layout">
          <section className="stack">
            <h2>Choose tickets</h2>
            {types.map((t) => (
              <div className="panel stack" key={t.id}>
                <h3>{t.name}</h3>
                <p>
                  {formatMoney(BigInt(t.price))} per{" "}
                  {t.admissions > 1 ? "package" : "ticket"}
                </p>
                {t.admissions > 1 && (
                  <p>
                    Includes {t.admissions} admissions. Guests can arrive
                    separately.
                  </p>
                )}
                <label>
                  Quantity — {t.name}
                  <input
                    aria-label={`Quantity — ${t.name}`}
                    type="number"
                    min="0"
                    max={Math.max(0, t.maximum)}
                    step="1"
                    disabled={!t.available || t.maximum < t.minimum}
                    value={quantities[t.id] || 0}
                    onChange={(e) =>
                      setQuantities({
                        ...quantities,
                        [t.id]: Math.max(
                          0,
                          Math.min(
                            t.maximum,
                            Math.floor(Number(e.target.value) || 0),
                          ),
                        ),
                      })
                    }
                  />
                </label>
                <small>
                  {t.available && t.maximum >= t.minimum
                    ? `Choose 0, or ${t.minimum}–${t.maximum}.`
                    : "Currently unavailable"}
                </small>
              </div>
            ))}
          </section>
          <section className="panel stack">
            <h2>Your details</h2>
            <label>
              Full name
              <input name="name" autoComplete="name" maxLength={200} required />
            </label>
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={320}
                required
              />
            </label>
            <label>
              Phone number (optional)
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                maxLength={32}
              />
            </label>
            <p className="price">Estimated total: {formatMoney(total)}</p>
            <p className="muted">
              The final price and availability are confirmed when you reserve.
              Your details are used for this order; no account is required.
            </p>
            <button className="button" disabled={busy}>
              {busy ? "Reserving…" : "Reserve tickets"}
            </button>
          </section>
        </form>
      )}
    </div>
  );
}
