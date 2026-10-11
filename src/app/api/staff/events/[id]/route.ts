import { getPool } from "@/db/client";
import { checkOrigin, readJson } from "@/modules/auth/http";
import { consumeLimit } from "@/modules/auth/throttle";
import { gateActor, gateFailure } from "@/modules/checkin/http";
import { admit, gateView, GateError } from "@/modules/checkin/service";
import { z } from "zod";
const lookup = z
  .object({
    action: z.literal("lookup"),
    search: z.string().trim().min(3).max(200).optional(),
  })
  .strict();
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const actor = await gateActor(request.headers);
    if (!(await consumeLimit(getPool(), `gate:${actor.userId}`, 120, 60)))
      throw new GateError(
        429,
        "Too many requests. Wait a moment before retrying.",
      );
    const { id } = await params;
    const body = await readJson(request);
    const input = lookup.safeParse(body);
    const data = input.success
      ? await gateView(getPool(), actor, id, input.data.search)
      : await admit(getPool(), actor, id, body);
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return gateFailure(error);
  }
}
