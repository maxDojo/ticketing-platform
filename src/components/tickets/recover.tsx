"use client";
import { useState, type FormEvent } from "react";
export function TicketRecovery() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tickets/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          reference: form.get("reference"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.message);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Unable to process request.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel stack">
      <h1>Find your test tickets</h1>
      <p>
        Enter the order reference and email used at checkout. Local previews
        only; no email is sent yet.
      </p>
      <form onSubmit={submit} className="stack">
        <label>
          Order reference
          <input name="reference" required maxLength={100} />
        </label>
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
          />
        </label>
        <button className="button" disabled={busy}>
          Request ticket link
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
