import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { organizerPage } from "@/modules/auth/page-access";
import { getManagedEvent } from "@/modules/events/service";
import { AccessError } from "@/modules/auth/access";
import { AdminShell } from "@/components/admin/shell";
import { Reports } from "@/components/reporting/reports";
export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await organizerPage();
  const { id } = await params;
  const data = await getManagedEvent(await headers(), id).catch((e) => {
    if (e instanceof AccessError && e.status === 404) notFound();
    throw e;
  });
  return (
    <AdminShell>
      <Link href={`/admin/events/${id}`}>Back to event</Link>
      <h1>{data.event.name} — organizer reports</h1>
      <Reports eventId={id} />
    </AdminShell>
  );
}
