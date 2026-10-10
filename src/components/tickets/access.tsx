"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
export function TicketAccess() {
  const token = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (token.current !== null) return;
    token.current = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
  }, []);
  async function open() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tickets/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current }),
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      location.replace(`/tickets?order=${encodeURIComponent(result.orderId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open tickets.");
      setBusy(false);
    }
  }
  return (
    <section className="panel stack">
      <h1>Open your test tickets</h1>
      <p>
        This private link gives access to every ticket in your order. It can be
        used once within 24 hours.
      </p>
      <button className="button" disabled={busy} onClick={open}>
        {busy ? "Opening…" : "Open tickets"}
      </button>
      {error && <p role="alert">{error}</p>}
      <Link href="/tickets/recover">Request a new ticket link</Link>
    </section>
  );
}
