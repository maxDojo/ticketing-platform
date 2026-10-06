import Link from "next/link";
export default function PaymentReturn() {
  // Provider query parameters are untrusted and confer no order access.
  return (
    <main id="main" className="workspace stack">
      <p className="eyebrow">Paystack test checkout</p>
      <h1>Return received</h1>
      <p>
        This return does not confirm payment. Automatic verification is the next
        implementation step; no tickets have been issued.
      </p>
      <p>
        Review this test transaction in your Paystack dashboard. Do not repeat
        payment because confirmation is unavailable here.
      </p>
      <Link href="/">Back to TicketSquare</Link>
    </main>
  );
}
