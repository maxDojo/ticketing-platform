import { organizerPage } from "@/modules/auth/page-access";
import { AdminShell } from "@/components/admin/shell";
import { EventForm } from "@/components/admin/event-form";
export default async function NewEvent() {
  await organizerPage();
  return (
    <AdminShell>
      <div className="page-title">
        <div>
          <p className="eyebrow">Event setup</p>
          <h1>Create an event</h1>
          <p className="muted">
            Start with a draft. Publish when you’re ready.
          </p>
        </div>
      </div>
      <div className="panel">
        <EventForm />
      </div>
    </AdminShell>
  );
}
