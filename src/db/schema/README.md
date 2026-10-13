# Database schema map

Application code and Drizzle use `../schema.ts` as the public entry point.
Table definitions live here, grouped by the workflow they support:

| File          | Contents                                                                      |
| ------------- | ----------------------------------------------------------------------------- |
| `events.ts`   | Events, ticket categories and event cancellations                             |
| `orders.ts`   | Orders, item snapshots, checkout retry keys and reservations                  |
| `payments.ts` | Payments, initialization, verification jobs, webhook receipts and fulfillment |
| `tickets.ts`  | Individual admissions and their protected credentials                         |
| `delivery.ts` | Delivery jobs, recovery grants and ticket access sessions                     |
| `check-in.ts` | Event staff membership and admission records                                  |
| `refunds.ts`  | Refund approval and processing state                                          |
| `columns.ts`  | Shared timestamp and integer-money column builders                            |

Authentication, organizer membership and audit tables remain in `../auth-schema.ts`.

Within this directory, import dependencies directly from their owning file, not
the public entry point. This keeps table initialization free of circular imports.
Keep helper functions out of the public entry point so Drizzle receives only schema
definitions.

Database triggers and additional guards live in the committed `drizzle/` migrations.
After reorganizing definitions, run `pnpm db:generate`: a file-only refactor should
report no schema changes and produce no migration.
