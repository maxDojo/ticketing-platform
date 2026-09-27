import type { PoolConfig } from "pg";

export function databaseConfig(value: string | undefined): PoolConfig {
  const invalid = () =>
    new Error("Invalid database configuration: DATABASE_URL");
  if (!value || !URL.canParse(value)) throw invalid();
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length < 2 ||
    url.hash
  )
    throw invalid();
  // URL SSL options override pg's ssl object. Reject all query parameters to
  // prevent silent certificate-validation bypasses or unexpected connection options.
  if (url.search) throw invalid();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return {
    connectionString: value,
    ssl: local ? false : { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    application_name: "ticketsquare",
  };
}
