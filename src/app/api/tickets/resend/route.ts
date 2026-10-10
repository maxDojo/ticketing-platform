import { z } from "zod";
import { setTimeout } from "node:timers/promises";
import { getPool } from "@/db/client";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import { requestResend } from "@/modules/delivery/access";
import { privateHeaders } from "@/modules/delivery/http";
export async function POST(request: Request) {
  const started = Date.now();
  try {
    checkOrigin(request);
    const input = z
      .object({
        email: z.email().trim().toLowerCase().max(320),
        reference: z.string().trim().min(1).max(100),
      })
      .strict()
      .safeParse(await readJson(request));
    if (input.success)
      await requestResend(getPool(), input.data.email, input.data.reference);
    await setTimeout(Math.max(0, 350 - (Date.now() - started)));
    return Response.json(
      {
        message:
          "If these details match an eligible order, a new ticket link will be prepared. In this local test, delivery is preview-only.",
      },
      { status: 202, headers: privateHeaders },
    );
  } catch (error) {
    return failure(error);
  }
}
