import { z } from "zod";
import { getPool } from "@/db/client";
import { env } from "@/config/server";
import { paymentConfig } from "@/config/payments";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import {
  guestIdentity,
  checkoutLimit,
  orderFailure,
} from "@/modules/orders/http";
import { OrderError } from "@/modules/orders/input";
import { initializePayment } from "@/modules/payments/service";
import { paystackGateway } from "@/modules/payments/paystack";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const guest = await guestIdentity();
    await checkoutLimit(guest, "payment", 10);
    if (
      !z
        .object({})
        .strict()
        .safeParse(await readJson(request)).success
    )
      throw new OrderError(400, "Submit only the order ID in the path.");
    const config = paymentConfig(process.env);
    if (!config)
      throw new OrderError(503, "Test payments have not been configured yet.");
    return Response.json(
      await initializePayment(
        getPool(),
        guest,
        (await context.params).id,
        env.APP_URL,
        paystackGateway(config.secret),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
