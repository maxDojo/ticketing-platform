import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import {
  guestIdentity,
  checkoutLimit,
  orderFailure,
} from "@/modules/orders/http";
import { createOrder, expireReservations } from "@/modules/orders/service";
import { getPool } from "@/db/client";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const guest = await guestIdentity();
    await checkoutLimit(guest, "create", 10);
    const body = await readJson(request);
    // A bounded opportunistic sweep complements the scheduled expiry worker.
    await expireReservations(getPool(), 10);
    const order = await createOrder(getPool(), guest, body);
    return Response.json(order, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
