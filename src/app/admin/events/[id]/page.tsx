import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { organizerPage } from "@/modules/auth/page-access";
import { AccessError } from "@/modules/auth/access";
import { getManagedEvent } from "@/modules/events/service";
import { localDateValue } from "@/modules/events/display";
import { AdminShell } from "@/components/admin/shell";
import { EventForm } from "@/components/admin/event-form";
import { TicketForm, PublishButton } from "@/components/admin/ticket-form";
export default async function Manage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await organizerPage();
  const { id } = await params;
  const result = await getManagedEvent(await headers(), id).catch((e) => {
    if (e instanceof AccessError && e.status === 404) notFound();
    throw e;
  });
  const { event, types } = result;
  return (
    <AdminShell>
      <div className="page-title">
        <div>
          <p className="eyebrow">{event.status}</p>
          <h1>{event.name}</h1>
          <Link href={`/events/${event.slug}?preview=${event.id}`}>
            Preview event ↗
          </Link>
          {event.status === "published" && (
            <p>
              <Link href={`/events/${event.slug}`}>Public event page ↗</Link>
            </p>
          )}
        </div>
        <PublishButton id={id} published={event.status === "published"} />
      </div>
      <section className="panel">
        <h2>Event details</h2>
        <EventForm
          id={id}
          initial={{
            ...event,
            artworkUrl: event.artworkUrl ?? "",
            startsAt: localDateValue(event.startsAt, event.timezone),
            endsAt: localDateValue(event.endsAt, event.timezone),
          }}
        />
      </section>
      <section className="stack">
        <h2>Ticket types</h2>
        <p className="muted">
          Capacity counts units/packages. Each admission can arrive separately.
        </p>
        {types.map((t) => (
          <details className="panel" key={t.id}>
            <summary>
              {t.name} · {t.soldUnits} sold · {t.reservedUnits} reserved ·{" "}
              {t.capacity - t.soldUnits - t.reservedUnits} remaining
            </summary>
            <TicketForm
              eventId={id}
              initial={{
                ...t,
                price: `${t.unitPrice / 100n}.${(t.unitPrice % 100n).toString().padStart(2, "0")}`,
                saleStartsAt: localDateValue(t.saleStartsAt, event.timezone),
                saleEndsAt: localDateValue(t.saleEndsAt, event.timezone),
              }}
            />
          </details>
        ))}
        <details className="panel" open={types.length === 0}>
          <summary>Add a ticket type</summary>
          <TicketForm eventId={id} />
        </details>
      </section>
    </AdminShell>
  );
}
