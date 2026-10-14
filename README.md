# TicketSquare

Mobile-first event ticketing for TicketSquare.ng. Organizer MFA, events, inventory reservations, test Paystack payments, individual QR admissions and private ticket recovery are available. Email delivery currently produces local previews only.

## Requirements and local setup

- Node.js 22.19 or later in the 22.x line (`nvm use` with nvm installed).
- Docker Desktop running (PostgreSQL 17 on loopback port 5433).
- pnpm 11.1.2 (`npm install --global pnpm@11.1.2` if needed).

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env.local
# Set BETTER_AUTH_SECRET in .env.local using: openssl rand -base64 48
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open the exact `APP_URL` from your configuration (http://localhost:3000 in `.env.example`).
`APP_URL`, `DATABASE_URL`, and `BETTER_AUTH_SECRET` are required at startup. The example supplies
local-only database credentials; no payment keys are needed. Local configuration is ignored by Git. Never
commit secrets or put credentials in `NEXT_PUBLIC_*` variables.

## Automated verification

CI runs formatting, lint, TypeScript, unit tests, database integration tests, the
production build, desktop/mobile browser tests, the dependency audit and the
synthetic backup/restore drill on pushes and PRs. Check the PR's **Checks** tab for
results. During development, run new or modified tests locally and leave the full
regression suite to CI unless investigating a failure.

| Command                 | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `pnpm test`             | Unit tests                                               |
| `pnpm test:integration` | Database integration tests in disposable databases       |
| `pnpm check`            | Formatting, lint, types, unit tests and production build |
| `pnpm test:e2e`         | Desktop and mobile browser tests                         |
| `pnpm audit:deps`       | Dependency vulnerability audit                           |
| `pnpm db:restore-drill` | Synthetic PostgreSQL backup and restore verification     |

To run automated browser tests yourself, start Docker and use:

```sh
pnpm db:up
pnpm db:migrate
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

Browser installation is a one-time download per machine/version. Stop `pnpm dev`
before building because development and production builds share `.next`. Playwright
uses the production build and starts its own server on port **3100**; stop any
existing service on that port first. Both desktop and mobile projects use Chromium.
These tests use synthetic fixtures and mocked payment transport; they do not prove
real Paystack webhook delivery or external email delivery.

Watch desktop tests in a visible browser:

```sh
pnpm test:e2e --project=desktop --headed
```

Run one browser flow or one integration suite:

```sh
pnpm test:e2e tests/e2e/checkout.spec.ts --project=desktop --headed
pnpm test:integration tests/integration/orders.test.ts
```

See [the integration suite map](tests/integration/README.md) for focused order,
payment and ticket tests. To run the complete checks locally:

```sh
pnpm db:up
pnpm db:migrate
pnpm check && pnpm test:integration && pnpm test:e2e && pnpm audit:deps && pnpm db:restore-drill
```

`pnpm format` formats maintained files; the supplied context document is excluded.
For a local production preview: `pnpm build && pnpm start`.

## Manual end-to-end rehearsal

### Prepare the environment

Use synthetic buyer details and a clearly named test event, such as **Launch
rehearsal**. Keep Paystack in **test mode**; live payments remain disabled.

- Keep your existing `.env.local`; do not overwrite it or regenerate established keys.
- Set `PAYSTACK_MODE=test` and use your Paystack **test** secret key. Follow
  [payment setup](docs/payments.md) for the complete configuration.
- Configure the separate ticket encryption keyring as described in
  [ticket key management](docs/tickets.md), and keep `TICKET_DELIVERY_MODE=preview`.
- Open the exact `APP_URL` consistently. Switching between `localhost` and
  `127.0.0.1` changes browser cookie scope and can break the rehearsal.
- Create an organizer account if needed with
  `pnpm organizer:create you@example.com "Your name"`. Sign in at `/admin/sign-in`,
  complete authenticator enrollment and keep recovery codes private. See
  [organizer access](docs/organizer-access.md).

Start the app with `pnpm dev`, or reuse the app already running on port 3000. Run
each worker in a separate terminal from the project directory:

| Terminal     | Command                        | Purpose                                      |
| ------------ | ------------------------------ | -------------------------------------------- |
| App          | `pnpm dev`                     | Website on port 3000                         |
| Reservations | `pnpm orders:worker`           | Release expired inventory holds              |
| Payments     | `pnpm payments:worker`         | Verify and reconcile test payments           |
| Delivery     | `pnpm tickets:delivery-worker` | Generate private local email previews        |
| Refunds      | `pnpm refunds:worker`          | Dispatch and reconcile approved test refunds |

Restart the app and workers after changing environment variables. Stop processes
you started with **Ctrl+C** after the rehearsal.

Use separate browser sessions for organizer, buyer and staff. For example, use a
normal browser profile for the organizer, a private window for the buyer and a
second browser/profile for staff. Private windows in the same browser may share
cookies; use a separate browser/profile for unauthorized-access checks.

For gate staff, provision an account assigned to your test event:

```sh
pnpm staff:create staff@example.test "Test staff" <event-uuid>
```

Replace `<event-uuid>` with your event's ID. The command prompts for a hidden
password. Staff sign in at `/staff/sign-in` and complete MFA. Existing staff can
be assigned with `pnpm staff:access grant staff@example.test <event-uuid>`.
The owning organizer can also check in guests; a separate staff account lets you
verify event-scoped permissions. See [staff setup](docs/check-in.md).

### Follow the happy path

| Step             | Action                                                                                                     | Expected result                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Create event     | Add a description, venue, future date and short reservation duration, such as two minutes                  | Draft stays private until published                               |
| Add categories   | Add single-admission tickets and a group package with three admissions; use small capacities, then publish | Correct prices, package sizes and availability                    |
| Reserve          | Open the published event in the buyer browser and start checkout                                           | Server-calculated total and reservation countdown                 |
| Reload           | Refresh checkout before paying                                                                             | The same reservation survives                                     |
| Cancel           | Cancel this unpaid reservation                                                                             | Inventory becomes available again                                 |
| Expire           | Start another reservation and wait past its deadline and the worker's next run                             | Expired hold releases inventory                                   |
| Pay              | Make a fresh group purchase through Paystack test checkout                                                 | Order becomes paid and three separate admission tickets appear    |
| Recover          | Open the generated `.local/ticket-mail/<job-id>.html` preview and use its link in the buyer browser        | Recovery grants access to the purchased tickets                   |
| Resend           | Submit buyer email and order reference at `/tickets/recover`                                               | A new preview is generated; the public response remains neutral   |
| Admit            | Scan one group member's QR as authorized staff                                                             | One admission succeeds; other members' tickets remain usable      |
| Duplicate scan   | Scan the same QR again                                                                                     | Already-checked-in response; no second admission                  |
| Separate arrival | Scan another group member's QR later                                                                       | That admission succeeds independently                             |
| Refund           | Make a separate unused test purchase and approve its refund from the organizer event page                  | Tickets become unusable; refund progresses through reconciliation |

A submitted refund can remain processing until Paystack reports completion. Check
its final status rather than treating submission as success. Do not use the
already-scanned order for this test: full refunds are refused after check-in.

Camera scanning requires camera permission and HTTPS or localhost. Display the QR
on another screen or a printed test ticket. A phone cannot reach the computer's app
through its own `localhost`; real phone/venue testing needs an HTTPS staging setup.
Do not expose the development server merely to complete this local checklist.

### Exercise failures and access boundaries

- Try opening the buyer's checkout or tickets in an unrelated browser session
  without a valid recovery link: private order/ticket access should be denied.
- Try purchasing more than available inventory: checkout should refuse it.
- Try scanning a cancelled or refunded admission: entry should be refused.
- Try staff access to an unassigned event: access should be denied.
- Disconnect the gate browser's network and attempt check-in: it must show failure,
  never a successful admission. There is no offline admission mode.
- Review organizer reports: sales, ticket and attendance counts should reflect the
  actions above. Keep refunded and unfulfilled payments distinct when comparing totals.

### Finish and record results

```sh
pnpm ops:check
```

Exit **0** means the included checks are clear, **1** means attention is required,
and **2** means the check could not complete. Old synthetic records can also trigger
attention. Follow [operations response steps](docs/operations.md); do not alter
financial history just to make the check green.

For failures, record the step, expected and actual result, browser/device and a
redacted screenshot. Never share ticket QR codes, recovery links, passwords or keys.
Local email previews contain bearer links; keep them private and remove expired
previews after testing as described in [delivery operations](docs/delivery.md).

Local previews do **not** verify external email delivery. A completed test payment
does **not** by itself prove webhook delivery: the verification worker can reconcile
it independently. Follow [payment verification](docs/payments.md) for the separate
reachable-webhook exercise. Production email, hosted recovery and physical venue
rehearsals remain launch work.

## Structure

```text
src/app/          Next.js pages and HTTP adapters
src/components/   Shared presentation
src/config/       Environment validation and security policy
src/modules/      Domain boundaries (implemented incrementally)
src/db/           PostgreSQL schema and server-only client
tests/e2e/        Browser and HTTP security smoke tests
docs/             Architecture, security and proposed domain decisions
```

## Current capabilities and launch status

The project supports organizer/staff MFA, event publishing, inventory reservations,
test Paystack payments, separate group admissions, private ticket recovery, online
check-in, organizer reporting, test refunds and account/session management.
Operations checks and a synthetic restore drill are also available.

Read [architecture](docs/architecture.md), [domain decisions](docs/domain-model.md)
and [security requirements](docs/security.md). Some domain documents retain
historical checkpoint notes; use the feature-specific operations guides below for
current workflows.

The current system is test-only. Live payments, external email delivery, hosting,
supervised workers, alert delivery, managed backups and production recovery/security
review remain launch gates. Promo codes and complimentary tickets are deferred.
The default dev/start scripts bind to loopback; deployment must explicitly configure
its listening interface, HTTPS, secrets and trusted proxy behavior.

## Database workflow

`pnpm db:up` starts local PostgreSQL; `pnpm db:down` stops it while preserving data.
The initialization script creates the application role only on the first empty-volume
startup. Do not delete the volume to fix schema problems. Existing installations created
before the role script need explicit role provisioning; contact the maintainer first.

`pnpm db:generate --name=change_name` generates SQL from schema changes. Review and
commit SQL plus metadata before `pnpm db:migrate`. For non-schema trigger changes,
use `pnpm exec drizzle-kit generate --custom --name=change_name` and fill the SQL.
Migrations use MIGRATION_DATABASE_URL; the web process uses restricted DATABASE_URL.

Tests require TEST_DATABASE_URL with create-database permission on a disposable local
PostgreSQL server. Tests create/drop uniquely named databases and fail if configuration
is missing or points remotely. CI provides PostgreSQL and runs these tests automatically.
No mocked database is used. The test suite also checks the local runtime role permissions.

The app shell can build without a reachable database but DATABASE_URL must have a valid
shape. Start or restart the dev server after updating environment variables. Organizer screens start at `/admin/sign-in`; published pages use `/events/<slug>`.

## Test ticket issuance

Paid test orders now issue one private QR per admission, including each member of a group.
See [ticket operations and key management](docs/tickets.md) before starting payments.
Run `pnpm tickets:issue` to recover missing admissions for already-paid test orders.
Run `pnpm tickets:deliver` for private local email previews and recovery links; see [delivery operations](docs/delivery.md). External email delivery remains separate work. Online test gate check-in is available; see [staff setup and check-in operations](docs/check-in.md).

## Organizer reports

Event owners can search orders and admissions, review sales/payment/attendance totals and download protected CSV exports. See [reporting definitions and export handling](docs/reporting.md). Test-only full refunds and permanent event cancellation are available; see [refund operations](docs/refunds.md). Run `pnpm refunds:worker` to dispatch and reconcile approved refunds.

Verified organizers and staff can manage passwords and signed-in sessions from Security. See [account security](docs/account-security.md).

Run `pnpm ops:check` to inspect overdue work and payment/ticket inconsistencies without changing records. See [operations health and response steps](docs/operations.md) for exit codes and deployment monitoring requirements.

Run `pnpm db:restore-drill` to verify a synthetic PostgreSQL backup and restore in disposable local databases. See [backup and recovery](docs/backup-recovery.md) for prerequisites and production recovery gates.
