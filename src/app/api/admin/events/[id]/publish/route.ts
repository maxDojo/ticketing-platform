import { publishEvent } from "@/modules/events/service";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import { AccessError } from "@/modules/auth/access";
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const body = (await readJson(request)) as { publish?: unknown };
    if (typeof body?.publish !== "boolean")
      throw new AccessError(400, "Choose publish or unpublish.");
    await publishEvent(request.headers, (await ctx.params).id, body.publish);
    return Response.json({ success: true });
  } catch (error) {
    return failure(error);
  }
}
