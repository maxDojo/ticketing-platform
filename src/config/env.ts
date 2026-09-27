import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_URL: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash
        );
      }, "Must be an HTTP(S) origin without credentials, path, query, or fragment"),
  })
  .superRefine((env, ctx) => {
    if (!URL.canParse(env.APP_URL)) return;
    if (env.NODE_ENV === "production" && !env.APP_URL.startsWith("https://")) {
      const host = new URL(env.APP_URL).hostname;
      if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "Production requires HTTPS",
        });
      }
    }
  });

export function parseEnvironment(input: Record<string, string | undefined>) {
  const result = schema.safeParse(input);
  if (!result.success) {
    // Only field names are exposed: validation errors must never print secret values.
    throw new Error(
      `Invalid environment configuration: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  }
  return result.data;
}
