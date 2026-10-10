import { connection } from "next/server";
import { TicketRecovery } from "@/components/tickets/recover";
export default async function Page() {
  await connection();
  return (
    <main id="main" className="workspace stack">
      <TicketRecovery />
    </main>
  );
}
