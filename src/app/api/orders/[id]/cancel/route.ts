import { checkOrigin, failure } from "@/modules/auth/http";
import {
  guestIdentity,
  checkoutLimit,
  orderFailure,
} from "@/modules/orders/http";
import { accessOrder } from "@/modules/orders/service";
import { getPool } from "@/db/client";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const guest = await guestIdentity();
    await checkoutLimit(guest, "cancel", 20);
    return Response.json(
      await accessOrder(getPool(), guest, (await context.params).id, true),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
