"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
type Ticket = {
  id: string;
  reference: string;
  status: string;
  ordinal: number;
  category: string;
  qr: string | null;
};
type Wallet = {
  event: { name: string; venue: string; starts_at: string; timezone: string };
  tickets: Ticket[];
};
export function TicketWallet() {
  const [data, setData] = useState<Wallet | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const orderId = new URLSearchParams(location.search).get("order");
    void fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setData(body);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Unable to load tickets.");
      });
    return () => controller.abort();
  }, []);
  return (
    <>
      <h1>Your test tickets</h1>
      <p>Test preview only — these tickets do not grant admission.</p>
      <p>
        Each QR represents one person. Group members can arrive separately.
        Share each downloaded ticket only with its intended attendee; a copy has
        the same credential.
      </p>
      <p>
        Private browser access lasts 24 hours. Save each ticket now. Delivery is
        currently a local preview; check-in is not available yet.
      </p>
      <Link href="/tickets/recover">Request a new ticket link</Link>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading tickets…</p>}
      {data && (
        <>
          <h2>{data.event.name}</h2>
          <p>
            {data.event.venue} ·{" "}
            {new Intl.DateTimeFormat("en-NG", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: data.event.timezone,
            }).format(new Date(data.event.starts_at))}{" "}
            ({data.event.timezone})
          </p>
          {!data.tickets.length && (
            <p>
              Your payment is confirmed. Tickets are being prepared; check again
              shortly.
            </p>
          )}
          <div className="ticket-wallet">
            {data.tickets.map((t) => (
              <article key={t.id} className="panel stack">
                <h3>
                  {t.category} · Admission {t.ordinal}
                </h3>
                <p>{t.reference}</p>
                {t.qr ? (
                  <>
                    <Image
                      unoptimized
                      src={t.qr}
                      width={320}
                      height={320}
                      alt={`QR for ${t.category}, admission ${t.ordinal}`}
                    />
                    <a
                      className="button"
                      href={t.qr}
                      download={`${t.reference}.png`}
                    >
                      Download admission {t.ordinal} QR
                    </a>
                  </>
                ) : (
                  <p>Ticket {t.status}. QR unavailable.</p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
