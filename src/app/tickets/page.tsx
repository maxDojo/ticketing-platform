import { connection } from "next/server";
import { TicketWallet } from "@/components/tickets/wallet";
export default async function Tickets() {
  await connection();
  return (
    <main id="main" className="workspace stack">
      <TicketWallet />
    </main>
  );
}
