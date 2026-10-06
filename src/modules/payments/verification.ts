import { z } from "zod";
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const verifiedTransaction = z.object({
  reference: z.string().min(1).max(100),
  status: z.string().min(1).max(40),
  domain: z.string().max(20),
  amount: minor,
  currency: z.string().length(3),
  fees: minor.nullish(),
});
export type VerifiedTransaction = z.infer<typeof verifiedTransaction>;
export type VerifyGateway = (reference: string) => Promise<VerifiedTransaction>;
export function paystackVerifier(
  secret: string,
  transport: typeof fetch = fetch,
): VerifyGateway {
  if (!/^sk_test_[A-Za-z0-9]{10,}$/.test(secret))
    throw new Error("Only test credentials are supported");
  return async (reference) => {
    if (!/^[A-Za-z0-9.=-]{1,100}$/.test(reference))
      throw new Error("Invalid payment reference");
    const response = await transport(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
        cache: "no-store",
      },
    );
    if (!response.ok || !response.body)
      throw new Error("Verification unavailable");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new Error("Invalid provider response");
      }
      chunks.push(value);
    }
    const result = z
      .object({ status: z.literal(true), data: verifiedTransaction })
      .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return result.data;
  };
}
