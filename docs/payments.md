# Test payments — initialization, verification and recovery

Paystack integration remains opt-in and **test-only**. Live credentials are rejected.
This checkpoint confirms payments and secures inventory. QR issuance, email delivery,
refund execution, dispute handling and production deployment are still separate work.

## Local setup and joint review

Keep `PAYSTACK_MODE=test` and your test secret in `PAYSTACK_SECRET_KEY` in the ignored
`.env.local`. Never put secrets in chat, source control or NEXT_PUBLIC variables.
Apply migrations with `pnpm db:migrate`, restart the web server and run these workers
in separate terminals:

```sh
pnpm orders:worker
pnpm payments:worker
```

For one bounded verification pass, use `pnpm payments:verify`. The worker requires
only restricted DATABASE_URL credentials and the test Paystack key. No migration
credential is used at runtime. Workers must be supervised and monitored before any
public deployment; running the web process alone does not process payment jobs.

Create a future published event, reserve a nonzero NGN ticket and choose Paystack
checkout. Use [official test payment details](https://paystack.com/docs/payments/test-payments/).
TicketSquare absorbs processing fees. The server sends the frozen order total and
stores Paystack's reported fees separately; it does not add a buyer surcharge.
Card and bank transfer are requested, subject to the account's available channels.
Zero-price orders still do not use this payment flow or issue tickets.

After returning, the page uses a same-origin, cookie-authenticated POST to request
verification and read status. URL references alone grant no access. It polls for
up to about a minute, then offers a manual refresh. Guest access retains its
24-hour limit; another browser or cleared/expired cookies cannot retrieve the order.
Order history and verification continue independently of browser access.

## Webhook endpoint

`POST /api/paystack/webhook` accepts at most 64 KB of actual streamed bytes. It
validates `x-paystack-signature` using HMAC-SHA512 over the original bytes and a
constant-time comparison before parsing the event. Browser Origin/cookie checks do
not apply to this server-to-server endpoint. Invalid signatures are rejected.

Signed `charge.success` events with domain `test` and a known reference write a
minimal receipt and verification job in one transaction. Duplicate payloads do not
create duplicate work. No raw payload, authorization object, customer details or
secret is stored in the receipt or logged. Unrelated signed event types and unknown
references are acknowledged without touching orders because a Paystack account can
serve other applications. A 200 response is returned only after durable acceptance;
database failures return an error so Paystack can retry. Events merely queue work:
only the verification API can provide confirmation data used for fulfillment.

Paystack cannot deliver to localhost. **No public tunnel has been configured.**
The next joint check should expose only this endpoint through a temporary HTTPS
proxy after approval, then configure that address in the Paystack test dashboard.
Never expose the entire development server, admin pages, or database for this test.
Actual external webhook delivery remains unverified until that check is completed.
See [Paystack's webhook documentation](https://paystack.com/docs/payments/webhooks/).

## Durable verification and reconciliation

Initialization saves a payment reference and a job before contacting Paystack.
The worker also backfills missing jobs for older unresolved attempts. Jobs begin
30 seconds after a new attempt unless a webhook signals them sooner. Receipt jobs
are immediately due. Workers claim rows with SKIP LOCKED and a 60-second lease,
then release database locks before calling Paystack. An expired lease is reclaimable
after a crash. A notification arriving during processing schedules another pass
rather than being overwritten by the earlier result.

Provider calls use a fixed HTTPS endpoint, reject redirects, time out after 10
seconds and bound response sizes. Verification checks reference, test environment,
NGN currency and the saved integer-kobo amount. Unsafe numeric values are rejected.
Only required payment fields are retained. Failed provider calls do not mean a
failed payment. Pending, ongoing, abandoned or unfamiliar statuses remain unresolved.

Retries back off from 30 seconds to one hour. After 24 unsuccessful/unresolved
attempts, a job moves to attention and records an exception instead of disappearing.
Signed new notifications can wake it again. An organizer may explicitly requeue a
verification from the event's Payment review section; this action requires MFA,
event ownership, rate limits and creates an audit entry. Guest polling cannot reset
backoff or bypass an attention decision. A verified failure permits another attempt
within the original reservation; ambiguous initialization never starts another one.

Monitor pending-job age, expired leases, attention count, oldest unresolved payment,
worker errors and inventory exceptions. Alert on a growing backlog. The event page
shows the latest 50 attempts; it is not a complete reporting or incident dashboard.
Retention/pruning, pagination and deployment-specific monitoring remain launch work.

## Confirmation and exceptions

Confirmation locks order, payment, event and ticket types (in stable UUID order).
The expiry worker also locks order before inventory. Provider requests happen
outside these transactions. Successful verification, actual fees, inventory movement,
a unique fulfillment record and the paid state commit together. Database guards
prevent successful-payment and paid-order regressions, and one fulfillment per order
prevents repeated delivery. No tickets are created yet.

If the deadline passed, any remaining hold is first released and stock is reacquired
atomically. If stock is unavailable, or the order/event is unavailable, received
funds are recorded, inventory is not taken from another buyer, and the order moves
to `payment_exception`. Ticket sales windows do not revoke previously purchased
entitlements, but a cancelled/unpublished or started event requires manual review.

Wrong reference/amount/currency/environment blocks fulfillment and records a mismatch.
A second successful attempt is recorded as an excess payment without selling more
inventory. Reversal observations are flagged for manual review without pretending
the original sale never happened. Historical exception records remain visible even
if a later operational recheck succeeds.

Use the organizer Payment review panel to inspect provider references, reported fees,
verification state and exception history. Recheck only requests verification; it
never refunds money, adjusts stock, overrides a mismatch or retries a charge. Resolve
refund cases through an identity-verified operational process and Paystack dashboard
until the refund feature is implemented. Never promise a refund before confirmation.

## Evidence and remaining gates

Unit, PostgreSQL and desktop/mobile browser tests cover signatures, durable receipt
replay, provider validation, cross-guest access, concurrent confirmation, expiry
races, late-stock failure, excess payments, rollback, lease recovery and retries.
Browser tests send signed synthetic HTTP webhooks and use a synthetic verified
result for their own fixture; they do not fake provider results for other local jobs.

The recovery worker was also run against the previously completed Paystack-account
test transaction: NGN 1,000 verified, NGN 15 provider fees recorded, order paid,
reserved units zero and sold units one. No real money moved. Public webhook delivery
still needs the jointly reviewed HTTPS test. Production keys remain blocked until
fulfillment, recovery operations and the broader launch gates are complete.
