export function authSecret(value: string | undefined) {
  if (!value || value.length < 32 || value.includes("replace-me"))
    throw new Error("Invalid environment configuration: BETTER_AUTH_SECRET");
  return value;
}
