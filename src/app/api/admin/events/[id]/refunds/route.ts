import { z } from "zod";
import { getPool } from "@/db/client";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import { AccessError } from "@/modules/auth/access";
import { gateActor, gateFailure } from "@/modules/checkin/http";
import { consumeLimit } from "@/modules/auth/throttle";
import {
  refundRequest,
  refundView,
  approveRefund,
  recheckRefund,
  cancelEvent,
  RefundError,
} from "@/modules/refunds/service";
import { paymentConfig } from "@/config/payments";
const requestInput = z.discriminatedUnion("action", [
  refundRequest,
  z
    .object({
      action: z.literal("view"),
      search: z.string().max(200).default(""),
    })
    .strict(),
  z.object({ action: z.literal("recheck"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("cancel"),
      reason: z.string().trim().min(5).max(200),
      confirm: z.literal(true),
    })
    .strict(),
]);
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const actor = await gateActor(request.headers);
    const parsed = requestInput.safeParse(await readJson(request));
    if (!parsed.success)
      throw new RefundError(400, "Check the reason and confirmation.");
    if (!(await consumeLimit(getPool(), `refund:${actor.userId}`, 30, 60)))
      throw new RefundError(429, "Too many requests. Try again shortly.");
    const { id } = await params,
      input = parsed.data;
    if (input.action === "refund" && !paymentConfig(process.env))
      throw new RefundError(503, "Test payment configuration is required.");
    const result =
      input.action === "view"
        ? await refundView(getPool(), actor, id, input.search)
        : input.action === "refund"
          ? await approveRefund(getPool(), actor, id, input)
          : input.action === "recheck"
            ? await recheckRefund(getPool(), actor, id, input.id)
            : await cancelEvent(getPool(), actor, id, input.reason);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return error instanceof RefundError
      ? failure(new AccessError(error.status, error.message))
      : gateFailure(error);
  }
}
