"use client";
import { useEffect, useState, useRef, type FormEvent } from "react";
type Payment = {
  id: string;
  provider_reference: string;
  payment_status: string;
  amount: string;
  currency: string;
  order_reference: string;
  buyer_name: string;
  refund_state: string | null;
  provider_status: string | null;
  refund_id: string | null;
  fulfills_order: boolean;
  checked_in: number;
};
type Data = { event: { name: string; status: string }; payments: Payment[] };
const money = (p: Payment) =>
  `${p.currency} ${(BigInt(p.amount) / 100n).toLocaleString("en-NG")}.${(BigInt(p.amount) % 100n).toString().padStart(2, "0")}`;
async function request(id: string, body: object) {
  const r = await fetch(`/api/admin/events/${id}/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error ?? "Request failed.");
  return data;
}
export function Refunds({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Payment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const confirmation = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (selected) confirmation.current?.querySelector("input")?.focus();
  }, [selected]);
  useEffect(() => {
    let active = true;
    request(eventId, { action: "view" })
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setError("Refunds unavailable. Reload to try again.");
      });
    return () => {
      active = false;
    };
  }, [eventId]);
  async function run(body: object, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request(eventId, body);
      setSelected(null);
      setMessage(success);
      setData(await request(eventId, { action: "view", search }));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Request failed. Refresh before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function find(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setData(await request(eventId, { action: "view", search }));
    } catch {
      setError("Search unavailable.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack">
      <p>
        Test mode. Full refunds only. Approval immediately blocks the affected
        admissions. Failed or uncertain refunds keep them blocked. Inventory is
        not restocked, and processing fees are paid by us.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <form className="panel stack" onSubmit={find}>
        <label>
          Exact order reference, payment reference, or buyer email
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={200}
          />
        </label>
        <button className="button" disabled={busy}>
          Find payments
        </button>
      </form>
      <p>
        Showing up to 50 most recent payments. Use an exact reference to find an
        older payment.
      </p>
      {data?.payments.map((p) => (
        <article key={p.id} className="panel stack">
          <h2>
            {p.order_reference} · {p.buyer_name}
          </h2>
          <p>
            {money(p)} · {p.payment_status}
          </p>
          <p className="break-all">{p.provider_reference}</p>
          {p.refund_state ? (
            <>
              <p>
                Refund: {p.refund_state}
                {p.provider_status ? ` (${p.provider_status})` : ""}
              </p>
              {p.refund_state === "attention" && (
                <>
                  <p>
                    Review this transaction in Paystack before rechecking.
                    Rechecking never sends a second request after dispatch.
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      run(
                        { action: "recheck", id: p.refund_id },
                        "Refund queued for reconciliation.",
                      )
                    }
                  >
                    Recheck refund status
                  </button>
                </>
              )}
            </>
          ) : p.payment_status === "succeeded" ? (
            <>
              <p>
                {p.fulfills_order
                  ? "Refunding this payment blocks all admissions in this order."
                  : "This payment did not issue the order’s admissions; existing admissions are preserved."}
              </p>
              <button
                className="button"
                disabled={busy || (p.fulfills_order && p.checked_in > 0)}
                onClick={() => setSelected(p)}
              >
                Review full refund
              </button>
              {p.fulfills_order && p.checked_in > 0 && (
                <p>
                  Checked-in admissions require a separate exception review.
                </p>
              )}
            </>
          ) : null}
        </article>
      ))}
      {selected && (
        <form
          ref={confirmation}
          className="panel stack"
          key={selected.id}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              {
                action: "refund",
                paymentId: selected.id,
                reference: f.get("reference"),
                reason: f.get("reason"),
                confirm: f.get("confirm") === "on",
              },
              "Refund approved. The refund worker must reconcile it with Paystack.",
            );
          }}
        >
          <h2>Confirm full refund of {money(selected)}</h2>
          <label>
            Type the payment reference
            <input
              name="reference"
              required
              maxLength={100}
              autoComplete="off"
            />
          </label>
          <label>
            Internal reason
            <textarea name="reason" required minLength={5} maxLength={200} />
          </label>
          <label>
            <input
              className="refund-confirm"
              type="checkbox"
              name="confirm"
              required
            />{" "}
            I approve the full refund and understand affected admissions remain
            blocked.
          </label>
          <button className="button" disabled={busy}>
            Approve full refund
          </button>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => setSelected(null)}
          >
            Keep payment
          </button>
        </form>
      )}
      {data && (
        <section className="panel stack">
          <h2>Cancel event</h2>
          <p>
            Event status: {data.event.status}. Cancellation permanently stops
            sales and entry. It does not automatically refund payments or notify
            buyers. Approve and track each refund separately.
          </p>
          {data.event.status !== "cancelled" && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  {
                    action: "cancel",
                    reason: f.get("reason"),
                    confirm: f.get("confirm") === "on",
                  },
                  "Event cancelled. Review payments for refunds and contact affected buyers.",
                );
              }}
            >
              <label>
                Cancellation reason
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={200}
                />
              </label>
              <label>
                <input
                  className="refund-confirm"
                  type="checkbox"
                  name="confirm"
                  required
                />{" "}
                Permanently cancel {data.event.name} and stop all entry and
                sales.
              </label>
              <button className="button" disabled={busy}>
                Cancel event permanently
              </button>
            </form>
          )}
        </section>
      )}
    </section>
  );
}
