# Domain model — checkpoints 2–5

The core schema is implemented in `src/db/schema.ts` and the committed migrations.
Accepted business rules: one event per order, multiple categories per order, optional
attendee names, independent group admissions, configurable event reservations,
snapshotted prices, multiple payment attempts with single fulfillment, and late-payment
recovery. The remaining application workflows below are plans for later checkpoints.

## Reservation and package decisions

- Events default to a 10-minute reservation, configurable by the organizer.
- Current guardrails allow whole minutes from 1 through 1440 (24 hours); changing
  these limits requires aligning schema, validation, and tests.
- The database captures the current event duration and database clock at order
  creation; caller-supplied reservation timestamps/durations are overwritten.
- Existing order deadlines are immutable. Editing event settings affects new orders only.
- Inventory counters represent purchasable units, not people. Two tables for six
  consume two units and produce twelve separate admissions with independent QR codes.
- Order items snapshot admissions per unit. Later ticket-type edits cannot alter
  purchased entitlement. Ticket ordinals are bounded by quantity × admissions per unit.

| Entity      | Relationships and key invariants                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| Event       | Unique public slug, publishing state, UTC timestamps, IANA event timezone                                       |
| TicketType  | Belongs to event; currency, minor-unit price, capacity, sale window, purchase limits                            |
| Order       | One event initially; buyer separate from attendees; immutable pricing/currency snapshot                         |
| OrderItem   | Belongs to order and ticket type; immutable name, unit-price and discount snapshots                             |
| Payment     | Many attempts per order; unique provider reference; expected and verified amount/currency                       |
| Ticket      | One admission; order item + admission ordinal unique; random public reference and separate secure QR credential |
| Reservation | Per-order/type quantities with expiry and explicit held/committed/released state                                |
| CheckIn     | Unique ticket admission record; actor, time and QR/manual method                                                |
| Refund      | Payment and affected ticket allocations; requested/processing/succeeded/failed state; unique provider reference |
| Outbox      | Durable side-effect record with unique business key, retries and execution status                               |
| AuditLog    | Actor, action, resource, timestamp and minimal redacted context                                                 |

Checkpoint 2 introduced Event, TicketType, Order, OrderItem, Payment and Ticket.
Checkpoint 3 added organizer authentication and admin audit records. Checkpoint 4
adds reservations and private guest retry identities. CheckIn, Refund and Outbox
remain future work. Keep attendee details on tickets initially if a standalone identity adds
no value. Discounts and promoter attribution arrive later with historical snapshots.

Store amounts as integer minor units plus currency. Prefer PostgreSQL bigint with
explicit application conversion/serialization and bounds; never silently coerce
values beyond JavaScript safe integer limits. Percentage calculations require an
explicit rounding rule. Use checks for nonnegative quantities/amounts and foreign
keys for ownership. Ensure event consistency across orders, items and ticket types,
using composite constraints where suitable rather than trusting a submitted ID.

## States

Orders: pending, expired, paid, cancelled, refunded, partially_refunded. Payment
attempts independently track failure; one failed attempt must not overwrite a paid
order. A successful charge that cannot be fulfilled requires an explicit
payment-exception state/work queue rather than pretending payment failed.

Tickets: valid, cancelled, refunded; entry state comes from the unique CheckIn
record rather than a second independently writable checked-in flag. Cancellation
and refund must serialize with check-in on the same ticket. Define checked-in
refund and re-entry policy before implementing either.

## Inventory strategy (implemented in checkpoint 4)

Reserve inventory when creating an order, not when browsing. Within a transaction,
lock affected ticket types in stable order, check sale windows and quantities,
atomically increase reserved inventory within capacity, and create order/items/holds.
Use database constraints and conditional updates, not read-then-write application checks.
The hold duration is organizer-configurable, with a 10-minute default and a frozen order deadline.

Expiry workers and payment confirmation lock the same order/holds/type rows with
consistent ordering. Expiry releases a hold once. Confirmation moves reserved to
sold once. Live availability excludes active holds; expiry delays may temporarily
understate availability but must never oversell. Test deadlocks and bounded retries.

A late successful payment must never blindly reclaim released inventory. Proposed
policy: atomically reacquire if stock remains; otherwise record received funds and
an unfulfilled payment exception, issue no ticket, and route to reconciliation/refund.
The customer must see a recovery state. This recovery policy is accepted; its implementation and operational handling arrive with checkout/payments.

## Payment confirmation and issuance plan

1. Generate a unique reference for each payment attempt against an immutable order total.
2. Initialize through a provider adapter; use a durable record to recover ambiguous timeouts.
3. Authenticate raw webhook bytes using the provider signature; bound request sizes.
4. Independently verify success/reference/amount/currency with Paystack server-side;
   perform network requests before taking transaction locks.
5. Lock order and attempt; reject mismatches. Persist the provider result once.
6. Commit paid order, inventory conversion, unique admission records and notification
   outbox in one database transaction when issuance is introduced.
7. Return success only after durable handling. Retryable failures must remain retryable.

Webhook, redirect-triggered verification and reconciliation use the same service.
A browser redirect alone never changes payment state. Unique attempt references,
admission ordinals and outbox business keys guard against duplicates. Additional
successful attempts are recorded as excess payments for reconciliation, not new tickets.
Pending attempts are reconciled on a schedule. Paid-but-unissued orders are monitored.

Email delivery is retried independently and never rolls back a paid order. Provider
idempotency should be used when available; crashes after sending may otherwise cause
repeat emails, which must never create repeat admissions.

## Credentials and entry

Generate random QR bearer credentials separate from public references and retrieval
credentials. Store verifiers hashed. Re-rendering the same QR for download/retrieval
requires recoverable credential material: propose encrypting that material with a
separate managed key, while lookup uses a hash. Review key rotation and backup handling
before implementation; do not invent custom cryptography. Secure order-access tokens
have their own expiry/revocation policy and must never grant staff/admin permissions.

Check-in locks the ticket, validates event/status/authorization and inserts a unique
CheckIn atomically. Two simultaneous scanners yield one entry and one already-used
result. Offline failure means unable to verify, never successful admission.

## Enforced now versus later

PostgreSQL currently enforces nonnegative/exact row totals, event/currency ownership,
unique provider references, immutable order/item snapshots, valid timezones, inventory
counter bounds, successful-payment verification fields, paid-order ticket prerequisites,
and unique/bounded admissions. These are integrity constraints, not proof of provider
verification or user authorization.

Checkpoint 4 reconciles item sums with order totals transactionally and enforces
sale windows, quantity limits, event status and hold lifecycle. Guest checkout and
its expiry worker now reserve and release stock. Promo usage remains checkpoint 9;
fees and discounts are currently zero. See [checkout operations](checkout.md). Checkpoint 5 now verifies test-mode Paystack transactions, queues signed webhook
receipts and prevents paid-state regressions. Durable jobs and exception records
support recovery; public webhook delivery still needs an HTTPS integration test. Checkpoint 6 must issue credentials with reviewed
encryption/key management and unique fulfillment. Checkpoint 8 supplies the CheckIn
record and admission authorization. Guest order APIs require a private browser credential.

Ticket credential columns are storage contracts only: SHA-256 verifier hex, encrypted
credential envelope and key identifier. Only synthetic tests use placeholder encrypted
values. No production issuance or encryption implementation is present.
