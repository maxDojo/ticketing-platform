import Link from "next/link";
import { headers } from "next/headers";
import { organizerPage } from "@/modules/auth/page-access";
import { listEvents } from "@/modules/events/service";
import { AdminShell } from "@/components/admin/shell";
export default async function Events() {
  await organizerPage();
  const events = await listEvents(await headers());
  return (
    <AdminShell>
      <div className="page-title">
        <div>
          <p className="eyebrow">Organizer workspace</p>
          <h1>Your events</h1>
          <p className="muted">
            Create the experience. We’ll help you get people there.
          </p>
        </div>
        <Link className="button" href="/admin/events/new">
          Create event
        </Link>
      </div>
      {events.length ? (
        <div className="event-grid">
          {events.map((event) => (
            <Link
              className="panel event-card"
              href={`/admin/events/${event.id}`}
              key={event.id}
            >
              <span className="badge">{event.status}</span>
              <h2>{event.name}</h2>
              <p>
                {new Intl.DateTimeFormat("en-NG", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: event.timezone,
                }).format(event.startsAt)}
              </p>
              <p className="muted">{event.venue}</p>
              <span className="text-accent">Manage event →</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel">
          <h2>Your first event starts here.</h2>
          <p className="muted">
            Add event details, create ticket categories, and preview before
            publishing.
          </p>
        </div>
      )}
    </AdminShell>
  );
}
