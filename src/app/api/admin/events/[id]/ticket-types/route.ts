import { saveTicketType } from "@/modules/events/service";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const { id } = await ctx.params;
    const typeId = await saveTicketType(
      request.headers,
      id,
      await readJson(request),
    );
    return Response.json({ id: typeId }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
