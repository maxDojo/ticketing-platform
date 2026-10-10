import "server-only";
import { env } from "@/config/server";
export const accessCookie = env.APP_URL.startsWith("https:")
  ? "__Host-ts-ticket-access"
  : "ts-ticket-access";
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
