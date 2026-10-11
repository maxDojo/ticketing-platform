import { getPool } from "@/db/client";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import { AccessError } from "@/modules/auth/access";
import { gateActor, gateFailure } from "@/modules/checkin/http";
import { consumeLimit } from "@/modules/auth/throttle";
import { report } from "@/modules/reporting/service";
import { reportInput, ReportError } from "@/modules/reporting/input";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const actor = await gateActor(request.headers);
    const parsed = reportInput.safeParse(await readJson(request));
    if (!parsed.success) throw new ReportError(400, "Invalid report filters.");
    const input = parsed.data;
    if (
      !(await consumeLimit(
        getPool(),
        `report:${input.export ? "export" : "view"}:${actor.userId}`,
        input.export ? 5 : 60,
        60,
      ))
    )
      throw new ReportError(
        429,
        "Too many report requests. Try again in a minute.",
      );
    const { id } = await params;
    const data = await report(getPool(), actor, id, input);
    const headers = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (data.type === "download")
      return new Response(data.download, {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ticketsquare-${id}-${data.kind}.csv"`,
        },
      });
    return Response.json(data, { headers });
  } catch (error) {
    if (error instanceof ReportError)
      return failure(new AccessError(error.status, error.message));
    return gateFailure(error);
  }
}
