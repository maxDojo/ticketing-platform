import { cookies } from "next/headers";
import { z } from "zod";
import { getPool } from "@/db/client";
import { env } from "@/config/server";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import { consumeLimit } from "@/modules/auth/throttle";
import { orderFailure } from "@/modules/orders/http";
import { OrderError } from "@/modules/orders/input";
import { redeemAccess } from "@/modules/delivery/access";
import { accessCookie, privateHeaders } from "@/modules/delivery/http";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!(await consumeLimit(getPool(), "ticket-redeem-global", 120, 60)))
      throw new OrderError(429, "Please try again later.");
    const body = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .safeParse(await readJson(request));
    if (!body.success)
      throw new OrderError(
        404,
        "This link is invalid or expired. Request a new link.",
      );
    const result = await redeemAccess(getPool(), body.data.token);
    (await cookies()).set(accessCookie, result.session, {
      httpOnly: true,
      secure: env.APP_URL.startsWith("https:"),
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
    });
    return Response.json(
      { orderId: result.orderId },
      { headers: privateHeaders },
    );
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
