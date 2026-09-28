import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { checkOrigin, failure } from "@/modules/auth/http";
import {
  guestCookie,
  checkoutLimit,
  orderFailure,
} from "@/modules/orders/http";
import { env } from "@/config/server";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await checkoutLimit("shared", "session", 120);
    const jar = await cookies();
    if (!/^[a-f0-9]{64}$/.test(jar.get(guestCookie)?.value ?? ""))
      jar.set(guestCookie, randomBytes(32).toString("hex"), {
        httpOnly: true,
        secure: env.APP_URL.startsWith("https:"),
        sameSite: "strict",
        path: "/",
        maxAge: 86400,
      });
    return Response.json(
      { ready: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
