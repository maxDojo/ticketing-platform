# Organizer access and event publishing

Checkpoint 3 uses Better Auth with passwords and mandatory authenticator MFA.
Public signup is disabled. Accounts are provisioned by the maintainer, and the web
runtime cannot grant organizer privileges. Staff access comes with check-in later.

## Local setup

1. Generate a unique secret with `openssl rand -base64 48` and put it in
   `BETTER_AUTH_SECRET` in `.env.local`. Keep it stable and private: it protects
   authenticator secrets as well as sessions. Back it up securely with the database.
2. Run `pnpm db:migrate` using `MIGRATION_DATABASE_URL`.
3. Run `pnpm organizer:create you@example.com "Your name"` in your terminal.
   Enter a unique password of 14–128 characters at the hidden prompt. Never pass
   passwords in command arguments, chat, or source files. Provision only identities
   you have verified; this maintenance command marks their email as verified.
4. Start the app and open `/admin/sign-in` at the exact configured `APP_URL`.
5. Scan the QR in your authenticator and store the recovery codes privately.
   Complete verification before managing events.

A draft needs a description, future start time, and at least one active ticket
category to publish. Times are entered in the event's IANA timezone. Ambiguous
clock-change times are rejected. Prices are entered in naira and stored as exact
integer kobo. Capacity counts packages; people admitted per unit controls the
number of separate admissions. Reservation duration defaults to 10 minutes and
supports 1–1,440 minutes. This setting does not yet start a checkout reservation.

Draft previews require their owner's authenticated MFA session. Published events
appear at `/events/<slug>`. Booking is explicitly unavailable until checkout is
implemented. Artwork is an optional HTTPS URL loaded by the visitor's browser;
use a trusted host you control. No upload or server-side remote image fetch occurs.

## Sessions and recovery

Sessions expire after eight hours unless renewed by active use. Each session must complete MFA; enrolling one
session does not authorize older sessions. Device trust is disabled. Organizer
membership and session state are checked in the database on every protected service
call. Changes to events and ticket categories write an audit entry in the same
transaction. Audit records contain actor, action, resource ID and timestamp.

If an authenticator is lost, use an unused recovery code on the sign-in screen.
There is no public email-reset flow in this checkpoint. If all factors are lost,
contact the maintainer for identity-verified recovery; do not disable MFA through an
ad hoc public endpoint. A tested administrative recovery procedure and account
security management UI remain launch gates. Changing `BETTER_AUTH_SECRET` without
a migration/recovery plan can make existing authenticators unreadable.

For immediate access removal, a trusted database administrator can set
`organizers.active=false` for the affected user and remove their `auth_session`
rows. Never use the application role to grant or restore privileges. Existing
legacy events with no organizer remain inaccessible through the admin UI until a
trusted maintainer explicitly assigns their owner.

## Deployment prerequisites

Use HTTPS, a high-entropy managed secret and separate migration/runtime database
credentials. Apply the restricted runtime grants to the actual deployment role;
local migrations name `ticketsquare_app`. Do not expose the migration credential
to the deployed web process.

Authentication uses persistent global and identity limits plus Better Auth's
shared per-path limit. No forwarded IP header is trusted by default. Configure
trusted proxy attribution and edge request limits for the chosen host before
launch; do not trust arbitrary client-supplied forwarding headers. A shared bucket
can intentionally reject legitimate traffic during an attack. Per-identity POST
limits are 10 attempts per 15 minutes, with a global ceiling of 300 per minute and
an additional 60 per minute shared auth-path ceiling. Monitor and tune based on
measured traffic, retaining account protections. Schedule pruning of expired
`auth_throttle`, `auth_rate_limit`, `auth_verification`, and `auth_session` entries
with an explicit retention policy before launch. No background scheduler is
installed yet.

Browser tests create temporary synthetic organizers on a loopback database and
remove their fixtures. Failure traces can include synthetic authentication secrets;
keep test artifacts private and never run these fixtures against production.
