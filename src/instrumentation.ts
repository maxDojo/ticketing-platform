export async function register() {
  const { parseEnvironment } = await import("./config/env");
  parseEnvironment(process.env);
}
