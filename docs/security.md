# Security requirements and launch gates

Security is a release criterion, not a warranty. This document distinguishes the
implemented foundation from controls still required before customer use.

## Implemented in checkpoint 1

- Strict TypeScript and runtime origin configuration validation with redacted errors.
- Server-only configuration boundary, ignored environment files, explicit public-variable rule.
- Nonce CSP, no framing, no MIME sniffing, suppressed referrers, restricted browser permissions.
- No production browser source maps or framework identification header.
- Production build/browser smoke tests plus configuration and script-policy tests.
- Lockfile-based installs and a dependency audit command/CI job.

## Threats and required controls before the relevant feature ships

| Threat                          | Required control and verification                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Account takeover                | Maintained auth, organizer MFA, secure HttpOnly/SameSite cookies, CSRF protection, recovery/session revocation, sign-in rate limits      |
| Unauthorized object access      | Deny by default; authorize every service entry and event/resource lookup; tests for cross-event/staff/guest access                       |
| Forged payment/replay           | Raw-body signature validation, provider verification, immutable totals, unique references and transactional idempotency                  |
| Overselling/duplicate entry     | Real PostgreSQL concurrent integration tests, atomic state transitions, unique admission/check-in constraints                            |
| Ticket theft/enumeration        | Random separate access/QR credentials, expiry/revocation, neutral retrieval responses, no-referrer and private/no-store ticket responses |
| Injection/XSS                   | Runtime validation, parameterized queries, sanitized event rich text, CSP, no arbitrary HTML rendering                                   |
| Brute force/resource exhaustion | Shared rate limits, bounded payloads/quantities, provider timeouts and bounded retries; never rely on per-process memory in production   |
| PII/secret exposure             | Minimal fields, structured redacted logs, no raw webhook payloads/tokens in logs, managed secrets, secret scanning before release        |
| Malicious uploads/exports       | Limit file types/sizes, validate bytes, safe storage/serving; prevent CSV formula injection                                              |
| Data loss                       | Managed encrypted backups, separate privileges, verified restore drill, migration rollback/recovery plan                                 |
| Supply-chain compromise         | Review dependency advisories and lifecycle scripts; pinned direct dependencies, lockfile, regular updates                                |

Roles start with organizer and event-scoped check-in staff. No public admin signup.
Do not implement a homemade authentication system. No API keys, payment credentials,
PII, access URLs or session tokens may appear in NEXT_PUBLIC variables or analytics.

## Launch review

- Resolve all relevant controls above and test their failure/recovery behavior.
- Select hosting region and limits; enforce TLS and trusted proxy configuration.
- Keep test and live provider keys/data separate; restrict runtime database role.
- Run dependency and secret scanning and review unresolved findings explicitly.
- Establish alerting for payment exceptions, issuance failures and worker backlog.
- Test restore and event-day fallback procedures; assign incident ownership.
- Define retention/deletion and incident-response procedures for customer data.
- Review applicable privacy obligations, customer terms and refund policy with
  appropriate professional support. Engineering does not establish legal compliance.
- Consider an independent security review before accepting real customer payments.

Report security issues privately to the maintainer; never include credentials or
customer information in public issue reports. A public reporting contact must be
established before launch.

## Added in checkpoint 2

- Restricted local runtime role, separate migration credential and loopback-only Docker port.
- Remote PostgreSQL TLS certificate validation and rejection of SSL URL overrides.
- Bounded connection pool/timeouts and redacted connection/migration errors.
- Database constraints for ownership, amounts, snapshot immutability and admission identity.
- Real PostgreSQL tests for cross-event/currency violations, migration reruns, rollback,
  concurrent inventory updates and duplicate admissions.
- Checkpoint 2 exposed no public routes; checkpoint 3 adds authorized management and published event reads.
- The migration tool's legacy esbuild dependency is overridden to a patched version;
  migration compatibility is tested rather than ignoring the advisory.

## Added in checkpoint 3

- Maintained Better Auth authentication, provisioned organizers only, mandatory TOTP
  and per-session verification; recovery codes supported and device trust disabled.
- Server-side event ownership checks, unpublished-event isolation, active membership
  checks, and an append-only application audit trail.
- Explicit auth endpoint allowlist, exact-origin checks for mutations, bounded JSON,
  persistent throttling, input validation and plain-text event descriptions.
- Runtime role cannot grant organizer access or modify/delete audit history.
- HTTPS-only artwork URLs rendered directly in the browser with suppressed referrers;
  CSP permits HTTPS images, so organizers must use trusted artwork hosts.
- Desktop/mobile tests exercise enrollment, older unverified sessions, password-only
  denial, recovery-code login, deactivation, draft privacy and cross-owner access.
- Concurrent PostgreSQL tests cover atomic authentication limits and expiry.

See [organizer operations](organizer-access.md) for setup and limitations. Recovery
administration, security-management UI, rate-limit cleanup, host-specific proxy and
edge controls, monitoring, and a production security review remain launch gates.
