# Backup and recovery

## Repeatable local restore drill

With Docker running and the loopback `TEST_DATABASE_URL` configured, run:

```bash
pnpm db:up
pnpm db:restore-drill
```

The test credential needs database creation privileges. The command does not use
`DATABASE_URL` or `MIGRATION_DATABASE_URL` and does not back up your development
application database. It has no user-supplied restore target.

The drill:

1. Creates a random `ts_restore_<uuid>_source` database and applies committed migrations.
2. Seeds one synthetic paid group order with three separately encrypted admissions,
   fulfillment, inventory changes and a delivery job. Provider responses are synthetic;
   no external payment, refund or email request occurs.
3. Runs PostgreSQL `pg_dump` in custom format, then `pg_restore --exit-on-error
--single-transaction` into a second, newly created `ts_restore_<uuid>_target` database.
4. Compares hashes/counts for every table in `public` and `drizzle`, including migration
   history. Compares constraints, indexes, trigger definitions and public functions.
5. Decrypts all three restored admissions with the original ephemeral key, verifies
   missing/wrong keys fail, and confirms restored constraints reject invalid changes.
6. Closes pools, drops the generated databases and removes the temporary archive.
   Success is reported only after cleanup completes.

The archive lives in an OS temporary directory (0700), with file mode 0600. It
contains synthetic data only and is not encrypted. Ephemeral ticket keys remain
in process memory, separately from the dump. Nothing is uploaded or retained as a
CI artifact. This is a restore test, not a production backup implementation.

The default tool container is the local Compose `postgres` service. CI supplies
`RESTORE_DRILL_CONTAINER` using its PostgreSQL service container ID. Node connects
through the loopback test URL; PostgreSQL tools connect inside that same container
on port 5432 with the test credential passed through the environment, not arguments.
Use the project's PostgreSQL 17 container for both connections.

A nonzero exit is a failed drill. Errors omit credentials and data. If the process
is forcibly terminated, inspect leftover `ts_restore_*` databases and OS temporary
`ticketsquare-restore-*` directories privately. Confirm ownership and that no drill
is running before removing leftovers. Never delete a database merely because its
name resembles a temporary database.

CI runs the drill on every push and PR, alongside the test suites. To rerun only
connection-safety tests: `pnpm test:integration tests/integration/restore-drill.test.ts`.

## Production decisions still required

Before accepting live payments, choose the managed PostgreSQL service and document:

- Maximum acceptable data loss (RPO) and maximum recovery downtime (RTO).
- Encrypted automated backups and point-in-time recovery, retention, storage region,
  separate access controls and protection from deletion through a compromised app account.
- Backup age/failure alerts and an owner responsible for rehearsals and incidents.
- Secret/key recovery from a separate protected store: all still-referenced ticket
  keys, the authentication secret needed for encrypted MFA material, and provider
  configuration. Database backups alone cannot recover encrypted credentials.
- A rehearsal using the actual provider's backup, key retrieval and restricted
  runtime role. The local drill deliberately omits database ownership and grants;
  it does not prove hosted permissions, key-store availability or provider recovery.

Record the recovery point, restore duration, row/invariant checks, runtime access
checks and key-decryption results after each rehearsal. A successful synthetic drill
is useful regression evidence, but is not evidence that a deployed backup is usable.

## Incident recovery sequence

1. Stop sales, gate writes, background workers and automatic outbound side effects.
   Restrict access to the recovery environment and preserve incident evidence.
2. Choose a reviewed recovery point. Restore into a separate database with compatible
   PostgreSQL tooling; never overwrite the only surviving database or run unreviewed
   migrations to make a restore appear current.
3. Retrieve the matching secrets securely. Inspect migration history and deploy the
   corresponding application version. Restore reviewed runtime privileges separately
   from migration privileges. Verify ticket decryption without printing tokens.
4. Compare financial totals, fulfilled orders, ticket counts, inventory and check-in
   records. Run `pnpm ops:check` against the recovery environment, understanding that
   old leases and scheduled jobs can need reconciliation.
5. Reconcile the recovery gap against provider transaction/refund records and event-day
   admission records. A database restore cannot undo a charge, a refund, an email or a
   physical admission. Lost dispatch fences and webhook receipts can permit repeat work:
   do not restart payment/refund/delivery workers until the gap is reconciled.
6. Review restored authentication and ticket-access sessions: a backup may resurrect
   previously revoked access. Apply a reviewed session invalidation/recovery procedure
   before reopening access. Do not discard ticket keys or regenerate existing admissions.
7. Perform restricted smoke checks, approve cutover and resume workers gradually with
   monitoring. Preserve the old environment until recovery is independently verified.

This runbook does not automate production cutover, external reconciliation or session
invalidation. Those procedures and a real hosted restore rehearsal remain launch gates.
