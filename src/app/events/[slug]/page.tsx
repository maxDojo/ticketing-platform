import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { publicEvent, getManagedEvent } from "@/modules/events/service";
import { formatMoney, availability } from "@/modules/events/validation";
import { Brand } from "@/components/brand";
import { AccessError } from "@/modules/auth/access";
export default async function PublicEvent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  await connection();
  const { slug } = await params;
  const { preview } = await searchParams;
  const result = preview
    ? await getManagedEvent(await headers(), preview).catch((e) => {
        if (e instanceof AccessError) notFound();
        throw e;
      })
    : await publicEvent(slug);
  if (!result || result.event.slug !== slug) notFound();
  const { event, types } = result;
  return (
    <>
      <header className="admin-header">
        <Brand />
        <span className="muted">Official event page</span>
      </header>
      <main id="main" className="workspace">
        {preview && (
          <p className="notice">
            Organizer preview ·{" "}
            {"status" in event ? String(event.status) : "published"}
          </p>
        )}
        <div className="public-layout">
          <article className="stack">
            <div className="event-hero">
              {event.artworkUrl ? (
                <Image
                  unoptimized
                  width={1200}
                  height={600}
                  src={event.artworkUrl}
                  alt={event.name}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="hero-placeholder">
                  <span>BE THERE.</span>
                  <p>Your next shared experience.</p>
                </div>
              )}
              <div className="hero-title">
                <p className="eyebrow">TicketSquare presents</p>
                <h1>{event.name}</h1>
              </div>
            </div>
            <div className="panel form-grid">
              <div>
                <h2>Date & time</h2>
                <p>
                  {new Intl.DateTimeFormat("en-NG", {
                    dateStyle: "full",
                    timeStyle: "short",
                    timeZone: event.timezone,
                  }).format(event.startsAt)}
                </p>
                <small>{event.timezone}</small>
              </div>
              <div>
                <h2>Venue</h2>
                <p>{event.venue}</p>
              </div>
            </div>
            <section className="panel">
              <h2>The experience</h2>
              <p className="event-description">{event.description}</p>
            </section>
          </article>
          <aside className="stack ticket-sidebar">
            <div>
              <p className="eyebrow">Be part of it</p>
              <h2>Choose your experience</h2>
            </div>
            {types.map((t) => (
              <section className="panel" key={t.id}>
                <div className="page-title">
                  <h3>{t.name}</h3>
                  <span className="badge">{availability(t)}</span>
                </div>
                <p className="price">
                  {formatMoney(t.unitPrice)}{" "}
                  <small>
                    per {t.admissionsPerUnit > 1 ? "package" : "ticket"}
                  </small>
                </p>
                <p>{t.description}</p>
                {t.admissionsPerUnit > 1 && (
                  <p className="muted">
                    Includes {t.admissionsPerUnit} separate admissions. Guests
                    can arrive individually.
                  </p>
                )}
                <p className="muted">
                  {Math.max(0, t.capacity - t.reservedUnits - t.soldUnits)}{" "}
                  units remaining
                </p>
              </section>
            ))}
            {!types.length && <p>Ticket details will be announced soon.</p>}
            {!preview && (
              <Link className="button" href={`/checkout/${slug}`}>
                Choose tickets
              </Link>
            )}
            <div className="notice">
              Payments are not open yet. You can preview checkout and reserve
              tickets, but reservations do not grant admission.
            </div>
          </aside>
        </div>
      </main>
      <footer className="workspace muted">
        TicketSquare.ng · Shared experiences, simpler entry.
      </footer>
    </>
  );
}
