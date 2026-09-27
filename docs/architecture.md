# Architecture — checkpoint 2

## Accepted

- One Next.js App Router application on Node.js 22, strict TypeScript and pnpm.
- React and Tailwind for the mobile-first website; Stitch is the visual reference.
- PostgreSQL with Drizzle and reviewed SQL migrations, implemented in checkpoint 2.
- A modular monolith; thin web adapters and explicit application services.
- Vitest for unit/integration tests; Playwright against production builds for web flows.
- Security, payment correctness and event-day recovery are acceptance criteria.

The initial page is a holding page, not the event-publishing UI. System fonts avoid
an external build-time font dependency; licensed/self-hosted brand fonts can be
added during UI implementation. No authentication, payment processing or customer-facing data endpoints exist yet.

## Boundaries

`src/app` contains routes/layouts. `src/components` contains reusable presentation.
`src/modules` owns domain use cases. `src/db` owns database infrastructure.
`src/config` owns validation and browser policies. Server data access modules must
import `server-only`; no secret uses the `NEXT_PUBLIC_` prefix.

Keep provider calls outside database transactions. Use a durable outbox/worker
when introducing external side effects. A worker is another process using the
same codebase and database, not a separate microservice. Hosting must support a
web process, worker and reliable scheduler. Provider choice and budget remain open.

## Browser policy

Each request gets a fresh CSP nonce; incoming CSP/nonce headers are replaced.
Request-time rendering is intentional: cached nonce-bearing HTML is unsafe.
Production scripts use nonce + strict-dynamic without unsafe-inline/unsafe-eval.
Development alone enables eval and WebSockets for Next tooling. Inline styles are
permitted for framework compatibility; script policy remains strict. Camera is
restricted to this origin for the future scanner. Framing, plugins, geolocation,
and microphone use are blocked. Referrers are suppressed to protect future links.
HSTS is set in production without preloading or automatically covering subdomains.
This is a starting policy: explicitly review any new external asset/provider host.
HTTPS and trusted proxy configuration must also be enforced by the deployment.

## Configuration

APP_URL is mandatory at startup and must be a bare HTTP(S) origin. Production
requires HTTPS except loopback for local production smoke tests. Only current
modules require configuration: do not invent unused payment or auth secrets now.
Future credentials must become mandatory when their integration is added. Validation
errors list field names, never values. `src/config/server.ts` provides a server-only
entry point for consumers; never serialize its full result to the browser.

## Before the next checkpoints

The accepted core model is migrated; review docs/domain-model.md before changing its invariants. Select a maintained auth solution
supporting MFA before admin functionality; do not write password/session crypto.
Decide hosting, email, retention, event capacity, table admission rules, late-payment
policy and refund policy before the affected feature is implemented.

References: https://nextjs.org/docs/app/guides/content-security-policy and
https://www.postgresql.org/docs/current/ddl-constraints.html

## Tooling compatibility

TypeScript is pinned to 6.0.3 because the installed TypeScript ESLint tooling does
not yet support TypeScript 7. ESLint 9.39.5 is pinned because the React/import/a11y
plugins bundled with the current Next ESLint config do not support ESLint 10.
ESLint 9 has a registry deprecation notice; it is development-only. Track migration
to supported ESLint 10 plugins before launch. Never suppress peer errors or assume
new major versions are compatible merely because installation succeeds.

## Checkpoint 2 persistence

PostgreSQL 17 runs locally through Docker Compose, loopback only. Drizzle schema
and committed SQL migrations define six core tables. Cross-table admission validation,
reservation snapshots and historical immutability use reviewed PostgreSQL triggers.
Runtime and migration credentials are separate; remote pg connections require verified
TLS. Migration operations are explicit, transactional and serialized, not automatic
web-server startup side effects. See src/db/README.md for operational details.

Drizzle Kit 0.31.11 uses a legacy loader with an older esbuild dependency. A targeted
pnpm override pins that loader's esbuild to 0.25.12 to address GHSA-67mh-4wv8-2f99.
Migration generation and real PostgreSQL migration tests verify compatibility. Remove
the override when an upstream stable release removes the vulnerable dependency.
