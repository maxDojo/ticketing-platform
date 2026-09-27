# TicketSquare

Mobile-first event ticketing for TicketSquare.ng. Checkpoint 2 adds PostgreSQL, migrations and the core domain schema. Event setup,
authentication, checkout and ticket issuance are not implemented yet. The original project context is preserved.

## Requirements and local setup

- Node.js 22.19 or later in the 22.x line (`nvm use` with nvm installed).
- Docker Desktop running (PostgreSQL 17 on loopback port 5433).
- pnpm 11.1.2 (`npm install --global pnpm@11.1.2` if needed).

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000. `APP_URL` and `DATABASE_URL` are required at startup. The example supplies
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
Next is checkpoint 3: authentication, event management and the public event page.

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
shape. Start or restart the dev server after updating environment variables. The current
page is unchanged; this checkpoint adds persistence infrastructure, not new user screens.
