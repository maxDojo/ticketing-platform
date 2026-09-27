# TicketSquare

Mobile-first event ticketing for TicketSquare.ng. Checkpoint 1 establishes the
application foundation; event setup, authentication, database schema, checkout,
and ticketing are not implemented yet. The original project context is preserved.

## Requirements and local setup

- Node.js 22.19 or later in the 22.x line (`nvm use` with nvm installed).
- pnpm 11.1.2 (`npm install --global pnpm@11.1.2` if needed).

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000. No database or provider credentials are needed at this
checkpoint. `APP_URL` is required; local configuration is ignored by Git. Never
commit secrets or put credentials in `NEXT_PUBLIC_*` variables.

## Verification

```sh
pnpm check
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
src/db/           Database boundary (checkpoint 2)
tests/e2e/        Browser and HTTP security smoke tests
docs/             Architecture, security and proposed domain decisions
```

## Review checkpoint

Read [architecture](docs/architecture.md), [domain proposal](docs/domain-model.md)
and [security requirements](docs/security.md). The domain proposal covers reservations,
late payments, payment attempts, issuance idempotency and atomic check-in. It is not
a migrated schema. Next is checkpoint 2: review the model, then introduce local
PostgreSQL, migrations and core entities. Authentication belongs to checkpoint 3.

The holding page establishes basic palette and layout; it does not replace the
Stitch event/checkout/ticket designs. Security work remains at every later checkpoint;
the current foundation is not approved for real payments or customer data.
