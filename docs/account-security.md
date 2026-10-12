# Account security

Organizer and staff Security pages show authenticator enrollment/verification until the current session completes MFA. Verified sessions see password and session controls instead of being repeatedly prompted for a code.

## Password changes

Enter the current password and a matching new password of 14–128 characters. Better Auth validates and hashes the password. The server always sets `revokeOtherSessions=true`; clients cannot opt out. Better Auth revokes existing sessions and rotates the current cookie. The new session starts without MFA verification, so protected actions remain unavailable until an authenticator or unused recovery code verifies it. Password-change responses contain only a success flag; the rotated session token is not exposed in JSON.

No new public password-reset or signup route is enabled. The application does not display, store plaintext, or log entered passwords. A timeout or interrupted response can occur after a change has succeeded: try signing in with the new password before repeating a change. A maintainer must investigate persistent failures. Provider password changes, session rotation, and application audit writes are not a single database transaction; requested/completed audit records distinguish intent from confirmed HTTP completion, and a requested-only record does not prove the password stayed unchanged.

## Session controls

**Sign out other sessions** revokes existing other sessions while keeping the current browser signed in. **Sign out everywhere** requires a confirmation checkbox and revokes the current session too. Neither action affects another user's sessions. New logins remain possible with the valid password and authenticator; these controls are not account deactivation or a promise to stop an already executing request. For a suspected compromise, change the password and follow incident procedures.

Each operation requires a live MFA-verified session and active organizer or staff membership, exact-origin JSON requests and the existing persistent rate limits. The auth route allowlist exposes only the required revocation endpoint; session lists, tokens, MFA-disable and password-reset endpoints remain unavailable. Requested and completed actions are recorded using an opaque operation ID, with no passwords, cookies or session tokens in the audit. An audit failure before dispatch prevents the mutation; a failure afterward requires investigation rather than assuming the mutation rolled back.

## Authenticator recovery

Use an unused recovery code on the existing sign-in screen if the authenticator is unavailable. Store codes privately. Losing both factors still requires a separately verified administrative recovery procedure; no bypass or automatic MFA reset is introduced. Recovery-code rotation, secure administrative recovery, notifications for account changes and deployed-session monitoring remain launch work.

Browser tests use disposable organizer and staff identities and cover password-only denial, forced session revocation, MFA after password change, other-account isolation, same-origin enforcement, wrong passwords and the desktop/mobile Security forms. They do not change the developer's real local account.
