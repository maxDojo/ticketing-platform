-- Runtime credentials may maintain auth sessions, but cannot grant organizer access
-- or rewrite audit history. Production provisioning must use this role name or
-- apply equivalent explicit grants to its chosen runtime role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ticketsquare_app') THEN
    GRANT SELECT, INSERT, UPDATE ON auth_user, auth_account, auth_session, auth_verification, auth_two_factor, auth_rate_limit, auth_throttle TO ticketsquare_app;
    GRANT DELETE ON auth_session, auth_verification, auth_two_factor, auth_rate_limit, auth_throttle TO ticketsquare_app;
    REVOKE INSERT, UPDATE, DELETE ON organizers FROM ticketsquare_app;
    GRANT SELECT ON organizers TO ticketsquare_app;
    REVOKE UPDATE, DELETE ON admin_audit FROM ticketsquare_app;
    GRANT SELECT, INSERT ON admin_audit TO ticketsquare_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX auth_account_identity ON auth_account ("providerId", "accountId");
--> statement-breakpoint
CREATE INDEX events_organizer_idx ON events (organizer_id);
