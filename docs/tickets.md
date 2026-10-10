# Test admission issuance

Every verified, fulfilled order issues quantity × snapshotted admissions-per-unit
tickets. A table for six produces six independent QR credentials. New confirmation
commits payment, inventory, fulfillment and admissions together; an insertion failure
rolls back the entire transaction so the payment worker can retry. Stable order locks
and unique item/ordinal constraints prevent duplicates. Existing credentials are never
replaced during retries, including cancelled/refunded admissions.

Checkout limits an order to 500 admissions before reserving inventory or taking payment.
This bounds transactional work and private QR rendering. Categories can still describe
larger packages, but buyers must select purchases that fit this order limit. Historical
orders above the limit require an explicit migration/operations decision, not partial
issuance or silently truncated entitlement.

## Dedicated encryption keys

Configure server-only `TICKET_ACTIVE_KEY_ID` and `TICKET_ENCRYPTION_KEYS` (a JSON object
mapping key IDs to 64-character lowercase hex keys). Generate each value with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` locally
and store it in the ignored `.env.local` for this test environment. Never reuse the
auth secret, Paystack secret or CI fixture key. The local development key has already
been generated without printing its value. Do not commit or paste it into chat.

Credentials contain 32 cryptographically random bytes with a `tsq_test_v1_` prefix.
Public ticket references use independent random UUIDs and grant no retrieval rights.
SHA-256 hashes support future scanner lookup. Recoverable material uses Node's
AES-256-GCM with a fresh 12-byte nonce and 16-byte tag. Authenticated associated data
binds the envelope to the ticket ID, key ID and test/version context. Decryption also
checks token shape and verifier hash; tampering or unknown keys fail closed.

To rotate, retain all existing key entries and add a newly generated key under a new
ID; switch only the active ID and restart web/worker processes. Older tickets continue
to decrypt with their original ID. Never overwrite a key under an existing ID or remove
it while credentials still reference it. There is no bulk re-encryption tool yet.
Key loss prevents redisplaying old QRs; do not regenerate admissions to work around it.
Back up keys securely and separately from database backups. Before production, use a
managed secret/key service, restricted worker access and a tested restore/rotation
procedure; local environment-file storage is the test setup only.

Payment initialization and the verification worker fail closed if active key configuration
is missing. Decryption keys must be present in both web and worker processes. Restart
both after changing configuration.

## Recovery and viewing

`pnpm tickets:issue` repairs at most 20 paid, verified fulfilled orders per run. Repeat
until no admissions are issued. It never verifies a pending charge, changes inventory,
replaces existing credentials or sends email. Exceptions fail the command with a fixed
message; investigate before retrying. Monitor the difference between purchased admission
counts and actual tickets. New payments normally need no separate issuance worker.

The payment and checkout pages link to `/tickets?order=<id>`. The URL contains only an
order identifier; access requires the original private checkout cookie, whose server
authorization expires 24 hours after checkout creation. The same-origin POST endpoint
validates ownership, order/event status and ticket status, applies rate limits, and
returns private/no-store PNG data. It exposes no buyer details, encryption material or
raw QR tokens. Pages use no-referrer and noindex headers. Invalidated tickets omit QRs.

Each PNG download holds one QR and its filename identifies the public reference.
It is a bearer credential: sharing a copy does not create another admission. Only give
it to the intended attendee. The browser view supplies event/date/category context;
branded ticket documents and email attachments remain delivery work. Test QRs do not
grant entry. Scanning, duplicate-entry rejection and staff authorization are not yet
implemented, nor is private retrieval after the checkout cookie expires.

## Validation

Tests cover encryption tampering, swapped ticket identity, old-key decryption, group
counts, concurrent confirmation, rollback after partial insertion, recovery preserving
existing credentials, admission limits, cross-browser/expired access, cancelled-ticket
suppression, private headers and desktop/mobile PNG downloads.
