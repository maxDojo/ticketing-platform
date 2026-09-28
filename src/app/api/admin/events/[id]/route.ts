import { saveEvent } from "@/modules/events/service";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const { id } = await ctx.params;
    await saveEvent(request.headers, await readJson(request), id);
    return Response.json({ id });
  } catch (error) {
    return failure(error);
  }
}
