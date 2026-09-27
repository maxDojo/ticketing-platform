# Database boundary

`schema.ts` declares the six core PostgreSQL tables. `client.ts` is server-only and
lazily creates a bounded pg pool, reused across development reloads. No client logs
SQL or connection secrets. Monetary columns map to JavaScript bigint; serialize
amounts explicitly as decimal strings at future HTTP boundaries.

Run `pnpm db:generate --name=description` after schema changes and review the SQL.
Custom triggers live in a separate committed migration with a Drizzle journal entry.
Never edit an applied migration; write a new one. `pnpm db:migrate` uses the separate
MIGRATION_DATABASE_URL and serializes migration runs with a PostgreSQL advisory lock.
Migrations do not run at application startup. Do not use schema push in production.

DATABASE_URL is validated at startup without making a connection. Remote hosts require
certificate-verified TLS; connection-string query options are rejected to prevent SSL
overrides. If a provider requires a private CA, add explicit CA support before using it;
never set rejectUnauthorized=false. Loopback uses plaintext for local Docker tests.

Docker initialization creates a restricted local application role (read/insert/update;
no schema creation or row deletion) and default grants for future public tables. The
migration role owns DDL. These checked-in passwords are local-only examples. Production
must provision separate managed secrets/roles and reviewed retention operations.

Database integration tests create a unique temporary database on an explicitly supplied
loopback TEST_DATABASE_URL, run migrations twice and exercise constraints/concurrency.
They drop only that database. One read-only permission assertion checks DATABASE_URL
against the migrated local database. No customer or development rows are truncated.
