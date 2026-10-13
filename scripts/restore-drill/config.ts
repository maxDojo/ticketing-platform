import { databaseConfig } from "../../src/config/database";

export function drillConnection(value: string | undefined) {
  // Explicit test credential only: never fall back to runtime/migration URLs.
  const config = databaseConfig(value);
  const connection = new URL(config.connectionString!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(connection.hostname))
    throw new Error("Disposable loopback database required");
  return { config, connection };
}
