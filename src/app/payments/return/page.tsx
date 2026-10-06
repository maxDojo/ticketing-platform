import { connection } from "next/server";
import { PaymentStatus } from "@/components/payments/status";
export default async function PaymentReturn({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  await connection();
  const { reference } = await searchParams;
  const safe =
    typeof reference === "string" && /^[A-Za-z0-9.=-]{1,100}$/.test(reference)
      ? reference
      : null;
  // No order lookup during cross-site navigation. The client makes a same-origin,
  // cookie-authenticated POST; the URL reference alone grants no access.
  return (
    <main id="main" className="workspace stack">
      <p className="eyebrow">Paystack test checkout</p>
      <p>
        This return does not confirm payment. Only server verification can do
        that.
      </p>
      <PaymentStatus reference={safe} />
    </main>
  );
}
