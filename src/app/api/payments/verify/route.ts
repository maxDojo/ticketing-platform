import { z } from "zod";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import {
  guestIdentity,
  checkoutLimit,
  orderFailure,
} from "@/modules/orders/http";
import { requestGuestVerification } from "@/modules/payments/guest";
import { getPool } from "@/db/client";
import { OrderError } from "@/modules/orders/input";
import { paymentConfig } from "@/config/payments";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const guest = await guestIdentity();
    await checkoutLimit(guest, "verify", 30);
    if (!paymentConfig(process.env))
      throw new OrderError(503, "Payments unavailable.");
    const body = z
      .object({ reference: z.string().max(100) })
      .strict()
      .safeParse(await readJson(request));
    if (!body.success)
      throw new OrderError(400, "Invalid verification request.");
    return Response.json(
      await requestGuestVerification(getPool(), guest, body.data.reference),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
