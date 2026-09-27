# Proposed domain model — review before checkpoint 2

This is a proposal, not an implemented schema or approved business policy.

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

Do not create all entities in checkpoint 2: introduce later concepts with their
features. Keep attendee details on tickets initially if a standalone identity adds
no value. Discounts and promoter attribution arrive later with historical snapshots.

Store amounts as integer minor units plus currency. Prefer PostgreSQL bigint with
explicit application conversion/serialization and bounds; never silently coerce
values beyond JavaScript safe integer limits. Percentage calculations require an
explicit rounding rule. Use checks for nonnegative quantities/amounts and foreign
keys for ownership. Ensure event consistency across orders, items and ticket types,
using composite constraints where suitable rather than trusting a submitted ID.

## State proposals

Orders: pending, expired, paid, cancelled, refunded, partially_refunded. Payment
attempts independently track failure; one failed attempt must not overwrite a paid
order. A successful charge that cannot be fulfilled requires an explicit
payment-exception state/work queue rather than pretending payment failed.

Tickets: valid, cancelled, refunded; entry state comes from the unique CheckIn
record rather than a second independently writable checked-in flag. Cancellation
and refund must serialize with check-in on the same ticket. Define checked-in
refund and re-entry policy before implementing either.

## Inventory proposal

Reserve inventory when creating an order, not when browsing. Within a transaction,
lock affected ticket types in stable order, check sale windows and quantities,
atomically increase reserved inventory within capacity, and create order/items/holds.
Use database constraints and conditional updates, not read-then-write application checks.
The hold duration is configurable; 10 minutes is a proposal requiring review.

Expiry workers and payment confirmation lock the same order/holds/type rows with
consistent ordering. Expiry releases a hold once. Confirmation moves reserved to
sold once. Live availability excludes active holds; expiry delays may temporarily
understate availability but must never oversell. Test deadlocks and bounded retries.

A late successful payment must never blindly reclaim released inventory. Proposed
policy: atomically reacquire if stock remains; otherwise record received funds and
an unfulfilled payment exception, issue no ticket, and route to reconciliation/refund.
The customer must see a recovery state. This policy needs review before checkout.

## Payment confirmation and issuance proposal

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
