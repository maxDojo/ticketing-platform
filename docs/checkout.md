# Guest orders and reservations — checkpoint 4

Published event pages now link to `/checkout/<slug>`. Guests can select multiple
categories from one event, enter a name/email and optional phone, and reserve
inventory. There is no Paystack integration, payment confirmation, ticket issuance,
promo redemption, fee calculation, or email delivery yet. Even a zero-price order
remains pending and grants no admission in this checkpoint. Use synthetic buyer
details while testing locally.

## Correctness and retry behavior

The browser submits ticket IDs and quantities, never authoritative prices or totals.
One PostgreSQL transaction validates publication, future event start, active ticket
categories, NGN currency, sale windows and category purchase limits. It locks types
in stable UUID order, conditionally increments reserved units within capacity,
computes exact bigint kobo totals, and writes the order, immutable item snapshots,
reservation records and retry identity. Any category failure rolls back the entire
order. Discounts and fees remain zero; clients cannot submit either. Orders above
the JavaScript safe-integer boundary are rejected before payment integration.

Packages consume inventory units rather than admission count. Each item preserves
its purchased admissions per unit, name and price. Order expiry is captured by the
database from the organizer's reservation duration; subsequent edits cannot change
it. Inventory is reserved only on submission, never while browsing.

A retry key belongs to one guest and one canonical request. Concurrent identical
requests return the same order. Changed details with the same key return a conflict.
A retry of an expired or cancelled order never acquires inventory again. Creating
a new reservation requires a new key. The UI keeps the retry key and request digest
in session storage so retrying the same form after a lost response is safe. It also
restores the last successful order after a page reload in the same tab. Name, email,
phone and the access credential are not stored in session storage. Changing the
form after an uncertain response creates a new request; reload/retry the original
request first. Cross-device recovery is a later feature.

## Guest privacy and HTTP boundaries

A random 256-bit credential lives in an HttpOnly, SameSite=Strict cookie (Secure
and `__Host-` prefixed on HTTPS). Only its SHA-256 digest is stored in the database.
Order references and IDs alone do not authorize reads or cancellation. Cookies last
24 hours from checkout initialization; database access is also capped at 24 hours
from order creation. Clearing cookies or switching browsers loses guest access.
No credentials appear in URLs. Responses expose only the order summary, with no
buyer contact details. Checkout/API responses use private/no-store and noindex.

Mutations enforce exact Origin and JSON content type. Order creation bounds actual
request bytes to 32 KB, limits selections to 20 categories and rejects extra fields.
Shared PostgreSQL throttles limit creates to 10 per guest per 15 minutes, reads to
120 and cancels to 20. Each action also has a shared 120/minute ceiling; session
initialization has a conservative shared 120/15-minute ceiling. These protect the
local/pre-launch surface but do not replace host-level abuse controls: cookie
rotation can bypass a per-guest bucket and shared limits can deny legitimate traffic.
Bot/edge controls, tuned quotas and monitoring are required before public sales.

## Expiry operations

Run alongside the local web server in a second terminal:

```sh
pnpm orders:worker
```

The worker releases up to 500 expired orders every 15 seconds using restricted
`DATABASE_URL` credentials. It logs counts and generic failures without buyer data,
continues after transient failures, and shuts down on Ctrl-C/SIGTERM. For a single
maintenance pass or an external scheduler:

```sh
pnpm orders:expire
```

Before deployment, supervise the worker or schedule the one-shot job at least once
per minute, monitor failures and the age/count of pending expired orders, and alert
on a growing backlog. No hosted scheduler is provisioned by this checkpoint.
Without the worker, stock may remain conservatively unavailable. Each create
request additionally sweeps up to 10 expired orders; accessing an elapsed order
also releases it. These are fallbacks, not a substitute for scheduled expiry.

Expiry and guest cancellation lock the order first, then its ticket types in UUID
order. Release and status transition commit together. Concurrent workers use
SKIP LOCKED, and repeated release is harmless. Historical holds remain for recovery;
runtime credentials cannot delete them or reassign guest identities. Deadlock and
serialization failures retry up to twice; lock waits are bounded. A failed batch
can leave earlier orders released and is safe to rerun.

Payment confirmation must use the same lock ordering. The future late-payment
path must explicitly reacquire stock or record an unfulfilled payment exception;
it must not silently convert a released hold into a valid admission. `committed`
reservation state is reserved for that future integration.

## Verification

Real PostgreSQL tests cover exact prices, group snapshots, concurrent final-stock
buyers, concurrent retries, complete rollback, sale/publication/quantity boundaries,
guest isolation, cancellation/expiry races, immutable histories, zero-price orders
and excessive totals. Desktop/mobile browser tests exercise the complete reservation
flow, reload, retry, cookie protections, cross-guest denial, origin/size validation
and cancellation. Fixtures use isolated databases or temporary synthetic local rows;
never run them against production or publish their traces.
