# Online test check-in

Migration 0010 adds event staff assignments and one unique check-in record per
admission. This checkpoint remains test-only: QR credentials still use the test
namespace and live payments remain disabled. Promo codes and complimentary issuance
remain deferred by the project owner.

## Staff setup

Organizers can open check-in from their own event management page. For gate staff,
provision individual verified identities using the maintenance credential:

```sh
pnpm staff:create person@example.com "Staff name" <event-uuid>
pnpm staff:access grant person@example.com <another-event-uuid>
pnpm staff:access revoke person@example.com <event-uuid>
```

The create command prompts for a hidden password; never pass passwords as arguments.
Staff sign in at `/staff/sign-in`, enroll an authenticator and retain recovery codes
privately. Every session must complete MFA. Staff cannot create/manage events or
inspect payment records. The runtime database role cannot grant staff assignments
or change/delete check-in history. An owning active organizer can operate their own
event; organizer access is independent of any staff assignment.

Membership, session expiry and MFA are rechecked for every gate operation. Revocation
blocks subsequent authorization checks; an already-authorized in-flight request may
finish. Revoke all assignments and remove sessions through trusted maintenance when
an account/device is compromised. Account recovery remains a production launch gate.

## Entry behavior

Select the assigned event and start the camera. Scanning a valid QR immediately
records one admission. A successful response identifies the ticket and timestamp.
Repeated scans return already checked in, including scans of printed copies. There
is no re-entry, undo or offline admission mode in this checkpoint. Each group member
has a separate QR and may arrive separately, including after the event starts.
Published events permit scanning before the advertised start to support doors-open
operations; a configurable gate opening/closing window is not implemented.

Camera frames are decoded locally with the bundled jsQR library, never uploaded.
The camera stops after a decoded QR, when the page is hidden, or on navigation.
Camera access requires HTTPS (or localhost). Production phone/venue testing still
needs an HTTPS staging deployment; do not expose the development server through a
tunnel for this purpose without explicit approval.

Unknown and wrong-event credentials produce the same invalid result. Cancelled or
refunded tickets cannot be admitted, nor can tickets for an unpublished/cancelled
event. A partially refunded order can admit a remaining valid ticket. Authorization,
order and ticket checks run inside the admission transaction; row locks and the unique
ticket constraint prevent concurrent duplicate entry. The check-in and audit write
commit together. Later cancellation/refund workflows must use compatible locking.

If a request fails or times out, never treat it as admission. The transaction may have
committed before the response was lost: retry the same ticket to learn its stored
state. An already-checked-in result always requires staff judgement/escalation; it
must not be interpreted as permission to admit a second person.

## Manual fallback and history

Search by buyer name (minimum three characters), exact buyer email, order reference
or individual ticket reference. Up to 50 matches are shown; narrow the search if
needed. Search input travels in a private POST, not URL query strings. Staff see buyer
name, references, category, admission ordinal and check-in status, without contact
information, payment details or QR credentials. The buyer is not necessarily the
attendee: verify entitlement with the buyer or supervisor before selecting a ticket.

Manual check-in requires explicit confirmation and a 5–200 character reason. Enter
an operational reason, not sensitive identity details. It uses the same status and
duplicate-entry checks as QR scanning. Records retain actor, time, method and reason;
the gate view shows the latest 20 check-ins and a total count. Full reporting/export
and an organizer staff-management UI remain later work. The API caps each authenticated
account at 120 requests per minute; deployment-level abuse controls remain necessary.

## Verification and launch limits

PostgreSQL tests cover eight concurrent scans, independent group admissions, event
isolation, MFA/expiry/revocation, cancellation, audit rollback, and restricted runtime
permissions. Desktop/mobile Chromium tests enroll a staff MFA account, feed a real QR
image through a synthetic camera stream into the actual decoder, check repeated scans,
perform manual admission, and simulate network failure. These do not replace physical
phone-camera, lighting, printed-ticket and venue-connectivity rehearsal. Backend load
and event-day operational testing remain launch gates.

Decoder documentation: https://github.com/cozmo/jsQR
