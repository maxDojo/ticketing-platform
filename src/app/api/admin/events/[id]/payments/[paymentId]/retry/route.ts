import { checkOrigin, failure } from "@/modules/auth/http";
import { retryEventPayment } from "@/modules/payments/admin";
import { checkoutLimit, orderFailure } from "@/modules/orders/http";
import { requireOrganizer } from "@/modules/auth/access";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; paymentId: string }> },
) {
  try {
    checkOrigin(request);
    const actor = await requireOrganizer(request.headers);
    await checkoutLimit(actor.userId, "admin-recheck", 20);
    const { id, paymentId } = await context.params;
    await retryEventPayment(request.headers, id, paymentId);
    return Response.json({ queued: true });
  } catch (error) {
    return orderFailure(error) ?? failure(error);
  }
}
