# TicketSquare

Mobile-first event ticketing for TicketSquare.ng. Checkpoint 4 adds guest checkout, exact server pricing, inventory reservations, cancellation and expiry. Organizer MFA, event management and public pages are available. Payments and ticket issuance are not implemented yet.

## Requirements and local setup

- Node.js 22.19 or later in the 22.x line (`nvm use` with nvm installed).
- Docker Desktop running (PostgreSQL 17 on loopback port 5433).
- pnpm 11.1.2 (`npm install --global pnpm@11.1.2` if needed).

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# Set BETTER_AUTH_SECRET in .env.local using: openssl rand -base64 48
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open the exact `APP_URL` from your configuration (normally http://127.0.0.1:3000).
`APP_URL`, `DATABASE_URL`, and `BETTER_AUTH_SECRET` are required at startup. The example supplies
local-only database credentials; no payment keys are needed. Local configuration is ignored by Git. Never
commit secrets or put credentials in `NEXT_PUBLIC_*` variables.

## Verification

```sh
pnpm check
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit:deps
```

`check` runs formatting, lint, type checks, unit tests and a production build.
Playwright uses that build and starts an isolated production server on port 3100;
stop any service on that port first. Both mobile and desktop use Chromium. CI also
runs these checks. Browser installation is a one-time download per machine/version.
For a local production preview: `pnpm build && pnpm start`.

`pnpm format` formats maintained files; the supplied context document is excluded.
The default dev/start scripts bind to loopback. A future deployment must explicitly
configure its listening interface, HTTPS, secrets and trusted proxy behavior.

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

## Review checkpoint

Read [architecture](docs/architecture.md), [domain proposal](docs/domain-model.md)
and [security requirements](docs/security.md). The domain proposal covers reservations,
late payments, payment attempts, issuance idempotency and atomic check-in. The core model now has committed migrations and PostgreSQL integration tests.
Checkpoint 4 is implemented. Follow [organizer access](docs/organizer-access.md) to create
your account and publish an event. Follow [checkout operations](docs/checkout.md) to
try reservations and run `pnpm orders:worker` in a second terminal for timely stock
release. Checkpoint 5 now adds test-only Paystack initialization, signed webhook receipt,
verification and recovery. Run `pnpm payments:worker` alongside the expiry worker;
see [payment setup and review](docs/payments.md). Public webhook delivery is the
next joint test; ticket issuance follows after review.

The holding page establishes basic palette and layout; it does not replace the
Stitch event/checkout/ticket designs. Security work remains at every later checkpoint;
the current foundation is not approved for real payments or customer data.

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
Email delivery, persistent ticket retrieval and gate check-in remain separate work.
