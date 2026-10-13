# Integration tests

Order and payment coverage is grouped by workflow:

| Suite                            | Coverage                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `orders.test.ts`                 | Pricing, validation, inventory contention, guest access, cancellation and expiry |
| `payment-initialization.test.ts` | Starting checkout, concurrent starts and uncertain provider responses            |
| `payment-confirmation.test.ts`   | Confirmation, late payments, excess payments and transaction rollback            |
| `payment-verification.test.ts`   | Webhook validation, verification access, worker leases and retries               |
| `ticket-issuance.test.ts`        | Separate admissions, credential access, issuance rollback and recovery           |

These suites call `createOrderTestContext()` from `helpers/orders.ts` once at the
top level. Each call registers setup and teardown for a separate, randomly named
database. The helper requires a loopback `TEST_DATABASE_URL`, applies the committed
migrations, supplies synthetic fixtures and removes its database after the suite.
Clock changes and trigger overrides in these tests apply only to that disposable
database.

Run a single suite locally with Docker running and `.env.local` configured:

```bash
pnpm test:integration tests/integration/orders.test.ts
```

Pass additional file paths to run multiple changed suites. CI discovers all
`tests/integration/**/*.test.ts` files automatically and runs the complete suite.
