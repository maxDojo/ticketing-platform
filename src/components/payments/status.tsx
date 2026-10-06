"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/modules/events/validation";
type State = {
  status: string;
  payment_status: string | null;
  payment_attention: boolean;
  reference: string;
  total: string;
  event_slug: string;
};
export function PaymentStatus({ reference }: { reference: string | null }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(true);
  const [run, setRun] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;
    async function refresh() {
      if (!reference) {
        setError(
          "No payment reference was supplied. Return to your checkout to check its status.",
        );
        setWaiting(false);
        return;
      }
      try {
        const response = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
          cache: "no-store",
        });
        const data = await response.json();
        if (stopped) return;
        if (!response.ok)
          throw new Error(data.error ?? "Unable to check payment status.");
        setState(data);
        setError("");
        const terminal =
          [
            "paid",
            "payment_exception",
            "refunded",
            "partially_refunded",
          ].includes(data.status) ||
          data.payment_status === "failed" ||
          data.payment_attention;
        if (!terminal && ++count < 10) timer = setTimeout(refresh, 6000);
        else setWaiting(false);
      } catch (e) {
        if (!stopped) {
          setError(e instanceof Error ? e.message : "Unable to check payment.");
          setWaiting(false);
        }
      }
    }
    void refresh();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [reference, run]);
  const confirmed = state?.status === "paid" && !state?.payment_attention;
  const attention =
    state?.status === "payment_exception" || state?.payment_attention;
  const failed = state?.payment_status === "failed" && !confirmed && !attention;
  return (
    <section className="panel stack" aria-live="polite">
      <h1>
        {confirmed
          ? "Payment confirmed"
          : attention
            ? "Payment needs attention"
            : failed
              ? "Payment failed"
              : "Confirming payment"}
      </h1>
      {error && <p role="alert">{error}</p>}
      {state && (
        <>
          <p>Order reference: {state.reference}</p>
          <p className="price">{formatMoney(BigInt(state.total))}</p>
        </>
      )}
      <p>
        {confirmed
          ? "Your test payment is confirmed and inventory is secured. Ticket issuance is not available yet."
          : attention
            ? "This payment requires organizer review. Do not pay again. A refund has not been confirmed."
            : failed
              ? "Paystack reported a failed payment. You can retry from checkout if your reservation is still active."
              : "We are checking with Paystack. Do not pay again while the outcome is unresolved."}
      </p>
      {!waiting && !confirmed && !attention && !failed && (
        <button
          className="button"
          onClick={() => {
            setWaiting(true);
            setRun(run + 1);
          }}
        >
          Check again
        </button>
      )}
      {state && (
        <Link href={`/checkout/${state.event_slug}`}>Return to your order</Link>
      )}
    </section>
  );
}
