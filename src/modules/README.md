# Domain modules

Add modules at the checkpoint that implements them: events, orders, payments,
tickets, check-in, discounts, promoters, notifications, and reporting.

Application services own use cases and transaction boundaries. Pure domain logic
must not depend on Next.js or React. Provider adapters and database queries stay
server-only. HTTP handlers authenticate, validate, call services, and map results.
Server Components call services directly rather than making an internal HTTP hop.

Do not add empty services, speculative interfaces, or cross-module direct writes.
Pass the same database transaction through operations that must commit together.
Authorize every operation, including direct service calls from Server Actions.
