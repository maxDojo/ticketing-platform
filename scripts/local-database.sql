-- Disposable local development credentials only. Never run this on production.
CREATE ROLE ticketsquare_app LOGIN PASSWORD 'local-app-only' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE ticketsquare TO ticketsquare_app;
GRANT USAGE ON SCHEMA public TO ticketsquare_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ticketsquare IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO ticketsquare_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ticketsquare IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ticketsquare_app;
