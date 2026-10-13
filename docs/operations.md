# Operations health check

Run `pnpm ops:check` from a trusted terminal with `DATABASE_URL` configured. This
private command checks database-backed work; it is not a public endpoint or a
launch-readiness certification. It does not contact Paystack, send notifications,
release reservations, retry jobs or change records.

The command emits one JSON report containing a status, the overdue threshold and
aggregate check names/counts. It never emits customer details, order/payment IDs,
credentials, ticket links or raw database errors. Its single SELECT uses one
consistent snapshot and a read-only connection with the standard connection and
statement timeouts. Use the runtime credential, not the migration credential; a
dedicated SELECT-only monitoring role is preferable when deploying.

| Exit code | Meaning                           | Operator action                                                        |
| --------- | --------------------------------- | ---------------------------------------------------------------------- |
| 0         | All included checks are clear     | Continue monitoring                                                    |
| 1         | One or more checks need attention | Inspect the named workflow privately                                   |
| 2         | The check could not complete      | Investigate configuration/database access; never treat this as healthy |

## Checks and response

| Check                             | Trigger                                                                                                | Response                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `reservations_overdue`            | Pending order expired more than five minutes ago                                                       | Check the reservation worker; run `pnpm orders:expire` after addressing its failure                                      |
| `payments_overdue`                | Pending verification job is more than five minutes past its scheduled attempt, without an active lease | Check the payment worker and database; use `pnpm payments:verify` to process a batch                                     |
| `delivery_overdue`                | Pending delivery job meets the same overdue/lease rule                                                 | Check delivery configuration and worker; `pnpm tickets:deliver` currently produces local previews only                   |
| `refunds_overdue`                 | Approved/processing refund meets the same overdue/lease rule                                           | Check the refund worker and provider status; follow the refund runbook before taking action                              |
| `payments_attention`              | Verification job needs attention                                                                       | Review the organizer payment report and provider records; do not assume a payment failed or resend a charge              |
| `delivery_attention`              | Delivery job exhausted retries                                                                         | Fix the cause; expired links require a new resend, not an extended lifetime                                              |
| `refunds_attention`               | Refund needs operator reconciliation                                                                   | Review the organizer refund screen and provider records; never clear the dispatch fence or blindly submit another refund |
| `paid_orders_missing_tickets`     | A paid order has fewer admissions than its item snapshots require                                      | Investigate the issuance failure; `pnpm tickets:issue` can recover eligible missing admissions                           |
| `paid_orders_missing_fulfillment` | A paid order has no fulfillment record                                                                 | Investigate privately; do not fabricate verification or fulfillment records                                              |

The five-minute delay is measured from the scheduled attempt, not job creation.
Future retry backoff and unexpired worker leases do not trigger queue backlog
checks. Attention states and inconsistent paid orders trigger immediately.
Cancelled/refunded tickets still count as issued admissions. A single affected
order counts once, regardless of how many admissions are missing.

Attention counts reflect persisted state, including old unresolved test fixtures.
They are not automatically acknowledged or reset by this command. Investigate and
reconcile through the relevant workflow; never edit financial history merely to
make monitoring green.

## Deployment work still required

Connect this command to a supervised external scheduler and alert destination when
hosting is chosen. Start with a one-minute cadence and alert on nonzero exit codes,
timeouts, or missing scheduled runs. Assign an owner, deduplicate repeated alerts,
and verify delivery with a deliberate failed run. No scheduler or notifications
are configured by this checkpoint.

An empty backlog does not prove an idle worker is alive. Worker process supervision,
heartbeats, website uptime, email delivery/bounces, provider availability, backups
and restore drills require separate monitoring. Review query performance and the
five-minute threshold at production scale; a timed-out check is unavailable, never
healthy. This checkpoint does not enable production sales.
