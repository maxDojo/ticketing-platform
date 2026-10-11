import { notFound } from "next/navigation";
import { staffPage } from "@/modules/checkin/page";
import { gateView, GateError } from "@/modules/checkin/service";
import { getPool } from "@/db/client";
import { StaffShell } from "@/components/checkin/shell";
import { Gate } from "@/components/checkin/gate";
export default async function EventGate({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await staffPage();
  const { id } = await params;
  const data = await gateView(getPool(), actor, id).catch((e) => {
    if (e instanceof GateError && e.status === 404) notFound();
    throw e;
  });
  return (
    <StaffShell>
      <Gate eventId={id} eventName={data.event.name} />
    </StaffShell>
  );
}
