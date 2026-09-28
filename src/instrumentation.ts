export async function register() {
  const { parseEnvironment } = await import("./config/env");
  parseEnvironment(process.env);
  const { databaseConfig } = await import("./config/database");
  databaseConfig(process.env.DATABASE_URL);
  const { authSecret } = await import("./config/auth");
  authSecret(process.env.BETTER_AUTH_SECRET);
}
