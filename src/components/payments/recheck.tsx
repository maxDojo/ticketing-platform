"use client";
import { useState } from "react";
export function RecheckPayment({
  eventId,
  paymentId,
}: {
  eventId: string;
  paymentId: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch(
              `/api/admin/events/${eventId}/payments/${paymentId}/retry`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              },
            );
            setMessage(
              r.ok
                ? "Verification queued. Refresh shortly for the result."
                : "Unable to queue verification.",
            );
          } catch {
            setMessage("Unable to queue verification.");
          } finally {
            setBusy(false);
          }
        }}
      >
        Recheck payment
      </button>
      <p role="status">{message}</p>
    </div>
  );
}
