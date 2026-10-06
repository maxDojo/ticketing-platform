import { paymentConfig } from "@/config/payments";
import { getPool } from "@/db/client";
import { acceptWebhook } from "@/modules/payments/webhook";
import { OrderError } from "@/modules/orders/input";
import { orderFailure } from "@/modules/orders/http";
import { failure } from "@/modules/auth/http";
export async function POST(request: Request) {
  try {
    const config = paymentConfig(process.env);
    if (!config) throw new OrderError(503, "Payments unavailable.");
    if (!request.body) throw new OrderError(400, "Missing body.");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new OrderError(413, "Payload too large.");
      }
      chunks.push(value);
    }
    await acceptWebhook(
      getPool(),
      Buffer.concat(chunks),
      request.headers.get("x-paystack-signature"),
      config.secret,
    );
    return Response.json(
      { received: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
