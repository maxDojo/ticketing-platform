# Payments — step 1: test checkout initialization

This review step initializes Paystack-hosted checkout only. Verification, webhooks,
reconciliation, paid-state transitions, refunds and ticket issuance are not yet
implemented. Live mode and live keys are rejected. Payment integration is disabled
by default. Do not deploy this intermediate flow for customer payments.

## Try it together

In your ignored `.env.local`, set `PAYSTACK_MODE=test` and put your Paystack **test
secret key** in `PAYSTACK_SECRET_KEY`. Never paste the key into chat, commit it, or
use a NEXT_PUBLIC variable. Apply migrations with `pnpm db:migrate`, then restart
the web server. Continue running `pnpm orders:worker` for reservation expiry.

Create a future published event with a nonzero NGN ticket price, reserve using
synthetic buyer details, and click **Continue to Paystack (test)**. The buyer total
is the saved order total. TicketSquare absorbs Paystack processing fees; no buyer
surcharge is added. The integration requests card and bank transfer; availability
still depends on the Paystack account.

Use Paystack's official test payment details only. After returning, the page says
that payment is not confirmed by this application. Check the transaction in the
Paystack **test** dashboard. The order deliberately remains pending, and no tickets
are issued. This is the review boundary before verification is implemented.

[Initialize API](https://paystack.com/docs/api/transaction/)
[Official test details](https://paystack.com/docs/payments/test-payments/)

## Safety and failure handling

- The authenticated guest can start only their own active reservation for a
  published future event. The server loads the buyer email, currency and exact
  amount from the database. The endpoint accepts an empty object only.
- A transaction saves a unique payment reference and initialization record before
  contacting Paystack. Network calls hold no database locks. One attempt per order
  is enforced for this intermediate step.
- Repeated requests reuse the saved checkout URL when ready. An initializing or
  ambiguous attempt blocks a new call, including after a process crash. Do not
  delete that record and blindly retry: provider verification/recovery is the next
  step. Tests cover simultaneous starts and lost responses.
- The provider URL is fixed. Requests time out after 10 seconds and do not follow
  redirects. Responses are size-bounded; reference and checkout host are validated.
  Secrets, buyer details and authorization URLs are never logged by our adapter.
- Origin, guest access, request size and rate limits apply. Checkout URLs are
  sensitive and returned only to the owning browser in a no-store response.
- Once a payment exists, guest cancellation is blocked until its outcome can be
  resolved. Expiry still releases stock on the original deadline. Previously
  obtained Paystack URLs may remain usable after expiry; late-payment handling is
  not implemented yet, which is one reason this step permits test mode only.
- A provider redirect cannot authorize order access or change payment status.
  The neutral return page ignores reference/status query parameters and reveals no
  order information. SameSite=Strict remains unchanged.
- Gross amount is recorded now. Actual provider fees and net proceeds will be
  recorded from verified provider data in a later step, not estimated here.

Automated checks use a simulated provider and intercepted browser redirects, not
real test-account transactions. Passing them does not establish that the user's
Paystack account or enabled channels have been tested. A joint test-account run is
still required before proceeding to the confirmation implementation.
