import { connection } from "next/server";
import { TicketAccess } from "@/components/tickets/access";
export default async function Page() {
  await connection();
  return (
    <main id="main" className="workspace stack">
      <TicketAccess />
    </main>
  );
}
