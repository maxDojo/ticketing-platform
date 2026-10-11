# Test refunds and event cancellation

The event owner opens **Refunds and cancellation** from their event. Active organizer access and a live MFA-verified session are required on every request. Staff cannot approve refunds. Search uses an exact order reference, payment reference or buyer email, with at most 50 recent payments shown.

Approval requires the payment reference, a 5–200 character internal reason and explicit confirmation. Only verified, successful, nonzero payments qualify. The full verified charge is refunded; processing fees are absorbed by the platform. Partial refunds and checked-in admission exceptions are deferred.

For the payment that fulfilled an order, approval locks the order and admissions and refuses if any admission already checked in. All remaining valid admissions become cancelled in the same transaction as the approval and audit record, before provider contact. Refund failure never restores admission. An excess payment refund preserves the legitimate order and its admissions, including checked-in tickets. Refunds never restore sold inventory.

## Worker

Apply migrations, then run `pnpm refunds:process` once or `pnpm refunds:worker` continuously with the existing test payment environment. No live credential is accepted. The worker uses the restricted application database role. Do not run it against historical sandbox payments without reviewing their approvals first.

The worker verifies the original Paystack transaction, lists its refund history using the numeric transaction ID, and fetches the matching refund. Amount, currency, test domain, transaction and an opaque approval marker must match. Manual/partial/unrelated refunds, inconsistent history, reversed records and malformed responses require attention.

Before its single POST, the worker commits a durable dispatch timestamp. A crash or timeout after this point is ambiguous: subsequent runs inspect the provider and never resubmit. This includes a crash between committing the timestamp and sending the request. **Recheck refund status** queues inspection; it cannot clear the timestamp. If no matching refund exists, the approval stays in attention. Investigate in Paystack rather than editing database flags or creating a second approval. Requests use bounded responses, timeouts, fixed HTTPS endpoints and no redirects. Reasons are kept internally, not sent as customer notes.

Pending/processing refunds are polled every five minutes, up to 24 attempts per recheck cycle. Unknown, failed and needs-attention outcomes require organizer review. Needs-attention bank information is handled through Paystack's dashboard; the app does not collect it. Refund webhook events are not used; the worker must run for progress.

Only a matching fetched `processed` result marks the local refund processed. Fulfilled order admissions become refunded and the order becomes refunded. Original payment and fulfillment records remain intact. Reports retain historical gross sales and show confirmed refunds and unresolved approvals separately. Processor completion does not promise immediate bank availability.

## Cancellation

Cancellation records the owner, reason and time and permanently changes the event to cancelled. Sales and online entry stop immediately; existing paid tickets cannot enter a cancelled event. Republishing is blocked in both service and database. Pending payments still reconcile; they cannot fulfill a cancelled event. Cancellation does not automatically initiate refunds, restore stock or notify buyers. Review each payment for refund approval and contact affected buyers separately. Event cancellation and individual ticket states are separate records.

## Validation and remaining launch work

Automated tests use synthetic payments and mocked provider transport; they do not issue real refunds. A joint refund exercise with the user's Paystack test account is still required to verify account-specific API behavior and processing before any production rollout. Live enablement, external buyer notifications, cancellation bulk operations, settlement reconciliation and exception procedures remain launch work.

Provider contract: [Paystack refund API](https://paystack.com/docs/api/refund/) and [refund lifecycle](https://paystack.com/docs/payments/refunds/).
