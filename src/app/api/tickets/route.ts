import QRCode from "qrcode";
import { z } from "zod";
import { cookies } from "next/headers";
import { accessCookie } from "@/modules/delivery/http";
import { getPool } from "@/db/client";
import { checkOrigin, readJson, failure } from "@/modules/auth/http";
import {
  guestCookie,
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
    const jar = await cookies();
    const guest = jar.get(guestCookie)?.value ?? "";
    const access = jar.get(accessCookie)?.value;
    const validGuest = /^[a-f0-9]{64}$/.test(guest) ? guest : "";
    const validAccess =
      access && /^[a-f0-9]{64}$/.test(access) ? access : undefined;
    if (!validGuest && !validAccess)
      throw new OrderError(
        401,
        "Open your private ticket link or use the checkout browser.",
      );
    await checkoutLimit(validAccess ?? validGuest, "tickets", 60);
    const input = z
      .object({ orderId: z.uuid(), ticketId: z.uuid().optional() })
      .strict()
      .safeParse(await readJson(request));
    if (!input.success) throw new OrderError(400, "Invalid ticket request.");
    const data = await guestTickets(
      getPool(),
      validGuest,
      input.data.orderId,
      input.data.ticketId,
      validAccess,
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
