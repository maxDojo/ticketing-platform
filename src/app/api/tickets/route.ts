import QRCode from "qrcode";
import { z } from "zod";
import { getPool } from "@/db/client";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import {
  guestIdentity,
  checkoutLimit,
  orderFailure,
} from "@/modules/orders/http";
import { guestTickets } from "@/modules/tickets/guest";
import { OrderError } from "@/modules/orders/input";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const guest = await guestIdentity();
    await checkoutLimit(guest, "tickets", 60);
    const input = z
      .object({ orderId: z.uuid(), ticketId: z.uuid().optional() })
      .strict()
      .safeParse(await readJson(request));
    if (!input.success) throw new OrderError(400, "Invalid ticket request.");
    const data = await guestTickets(
      getPool(),
      guest,
      input.data.orderId,
      input.data.ticketId,
    );
    const tickets = await Promise.all(
      data.tickets.map(async ({ token, ...ticket }) => ({
        ...ticket,
        qr: token
          ? await QRCode.toDataURL(token, {
              width: 320,
              margin: 4,
              errorCorrectionLevel: "M",
            })
          : null,
      })),
    );
    return Response.json({ ...data, tickets }, { headers });
  } catch (error) {
    const response = orderFailure(error) ?? failure(error);
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  }
}
