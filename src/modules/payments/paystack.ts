import { z } from "zod";
export type InitializeInput = {
  reference: string;
  amount: string;
  email: string;
  callbackUrl: string;
};
export type PaymentGateway = (input: InitializeInput) => Promise<string>;
export function checkoutUrl(value: string) {
  const u = new URL(value);
  if (
    u.origin !== "https://checkout.paystack.com" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^\/[A-Za-z0-9_-]+$/.test(u.pathname)
  )
    throw new Error("Invalid checkout destination");
  return u.href;
}
export function paystackGateway(
  secret: string,
  transport: typeof fetch = fetch,
): PaymentGateway {
  if (!/^sk_test_[A-Za-z0-9]{10,}$/.test(secret))
    throw new Error("Only test credentials are supported");
  return async (input) => {
    // No provider response or request body is logged; either can contain secrets/PII.
    const response = await transport(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: input.email,
          amount: input.amount,
          currency: "NGN",
          reference: input.reference,
          callback_url: input.callbackUrl,
          channels: ["card", "bank_transfer"],
          bearer: "account",
        }),
      },
    );
    if (!response.ok || !response.body)
      throw new Error("Initialization unresolved");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new Error("Invalid provider response");
      }
      chunks.push(value);
    }
    const result = z
      .object({
        status: z.literal(true),
        data: z.object({
          reference: z.literal(input.reference),
          authorization_url: z.string(),
        }),
      })
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return checkoutUrl(result.data.authorization_url);
  };
}
