import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { organizerPage } from "@/modules/auth/page-access";
import { getManagedEvent } from "@/modules/events/service";
import { AccessError } from "@/modules/auth/access";
import { AdminShell } from "@/components/admin/shell";
import { Refunds } from "@/components/refunds/refunds";
export default async function RefundPage({
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
      <h1>{data.event.name} — refunds and cancellation</h1>
      <Refunds eventId={id} />
    </AdminShell>
  );
}
