import Link from "next/link";
import { staffPage } from "@/modules/checkin/page";
import { gateEvents } from "@/modules/checkin/service";
import { getPool } from "@/db/client";
import { StaffShell } from "@/components/checkin/shell";
export default async function Staff() {
  const actor = await staffPage();
  const events = await gateEvents(getPool(), actor);
  return (
    <StaffShell>
      <h1>Event check-in</h1>
      <p>
        Test admissions only. Online verification is required. Select your
        assigned event.
      </p>
      <div className="stack">
        {events.map((e) => (
          <Link className="panel" key={e.id} href={`/staff/events/${e.id}`}>
            {e.name}
          </Link>
        ))}
        {!events.length && <p>No events assigned.</p>}
      </div>
    </StaffShell>
  );
}
