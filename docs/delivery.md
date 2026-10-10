# Local ticket delivery and recovery

Migration 0009 adds a durable outbox, encrypted access grants and hashed access sessions.
Issuance queues one initial delivery in the payment transaction; retries do not create
more admissions or delivery jobs. The worker also backfills eligible paid orders.

## Run locally

Set `TICKET_DELIVERY_MODE=preview` in `.env.local`, retain the ticket keyring, and use
an HTTP loopback `APP_URL`. Run `pnpm db:migrate`, then `pnpm tickets:deliver` for one
batch or `pnpm tickets:delivery-worker` for continuous processing. Payment configuration
must remain in test mode. No email is sent and no external email provider is configured.

Previews are written to ignored `.local/ticket-mail/<job-id>.html`. Open the HTML locally
and use its link with the local app running. Files are private (0600; directory 0700)
and published atomically. They contain bearer access links: do not commit, upload,
serve publicly or share them. Delete expired previews and orphaned `.tmp` files after
review; automated retention is not implemented. Local previews do not prove email
ownership: anyone who can read the file can use its link.

## Access boundaries

Links contain 32 random bytes, expire after 24 hours, and can be redeemed once. The
secret is in a URL fragment, removed when the access page mounts; an explicit button
POST redeems it so merely fetching the page does not consume it. Successful redemption
sets a 24-hour HttpOnly, SameSite Strict cookie for one order. HTTPS uses a Secure
`__Host-` cookie. Opening another order's link replaces this recovery cookie. The
original checkout cookie remains independently usable during its original lifetime.
A lost redemption response requires a new link if the cookie was not received.

Database sessions store only SHA-256 hashes. Grant material uses AES-256-GCM with an
HKDF-separated key derived from the ticket keyring and a grant-specific authenticated
context. Keep old keyring entries while grants or tickets reference them. Revoking a
grant also denies its sessions. Expired sessions cannot retrieve tickets. Delivery,
resend and redemption require a paid, fulfilled order for a published event. Recovery remains available after the event starts so separately arriving guests can retrieve their admissions.

`/tickets/recover` accepts the buyer email and order reference. Responses are neutral
for matches, mismatches and throttled requests, with a minimum response delay. Limits
apply globally (60/minute) and per email/reference (3/hour). Resends create independent
links without revoking earlier links, so someone who knows the details cannot use this
form to invalidate existing access. QR credentials cannot act as recovery links.

## Retries and remaining work

Workers claim 60-second leases in batches of 20. Failed attempts back off from 30
seconds to a maximum of 30 minutes; after six attempts the job needs attention.
Retries preserve the same encrypted link and preview filename. Delivery cannot roll
back payment or issue duplicate admissions. Inspect attention jobs after fixing the
cause; an expired grant requires a new resend, not extending its lifetime. No operator
repair UI or alerting is provided yet.

A production email adapter still needs a verified domain, bounded delivery timeout,
provider idempotency, bounce handling, monitoring, privacy/retention rules and secure
key management. Gate scanning remains separate work. This checkpoint is local and
test-only, and does not enable live payments or deployment.
