# Database boundary

PostgreSQL and Drizzle are accepted. Schema, connection pool, database URL
validation, migration tooling and the local database arrive in checkpoint 2 after
the domain proposal in docs/domain-model.md is reviewed. No database is required
or contacted by checkpoint 1. All future runtime access must import server-only.

Use reviewed, committed SQL migrations. Never apply schema push commands to
production. Use a separate migration role from the restricted application role.
