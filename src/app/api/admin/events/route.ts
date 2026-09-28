import { saveEvent } from "@/modules/events/service";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const id = await saveEvent(request.headers, await readJson(request));
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
