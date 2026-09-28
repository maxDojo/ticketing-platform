import { failure } from "@/modules/auth/http";
import {
  guestIdentity,
  checkoutLimit,
  orderFailure,
} from "@/modules/orders/http";
import { accessOrder } from "@/modules/orders/service";
import { getPool } from "@/db/client";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const guest = await guestIdentity();
    await checkoutLimit(guest, "read", 120);
    return Response.json(
      await accessOrder(getPool(), guest, (await context.params).id),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
