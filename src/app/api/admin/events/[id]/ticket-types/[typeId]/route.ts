import { saveTicketType } from "@/modules/events/service";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; typeId: string }> },
) {
  try {
    checkOrigin(request);
    const { id, typeId } = await ctx.params;
    await saveTicketType(request.headers, id, await readJson(request), typeId);
    return Response.json({ id: typeId });
  } catch (error) {
    return failure(error);
  }
}
