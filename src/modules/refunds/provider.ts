import { z } from "zod";
const integer = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const transaction = z.object({
  id: integer,
  reference: z.string(),
  domain: z.literal("test"),
  amount: integer,
  currency: z.string().length(3),
});
const refund = z.object({
  id: integer,
  transaction: z.union([integer, transaction]),
  domain: z.literal("test"),
  amount: integer,
  currency: z.string().length(3),
  merchant_note: z.string(),
  status: z.string().max(40),
  reversed_at: z.null().optional(),
});
export type RefundJob = {
  id: string;
  reference: string;
  amount: string;
  currency: string;
};
export type RefundResult = { id: string; status: string };
export interface RefundGateway {
  inspect(job: RefundJob): Promise<RefundResult | null>;
  create(job: RefundJob): Promise<RefundResult>;
}
export function paystackRefunds(
  secret: string,
  transport: typeof fetch = fetch,
): RefundGateway {
  if (!/^sk_test_[A-Za-z0-9]{10,}$/.test(secret))
    throw new Error("Test credentials required");
  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await transport(`https://api.paystack.co${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || !response.body)
      throw new Error("Refund provider unavailable");
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        throw new Error("Invalid refund response");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  const marker = (job: RefundJob) => `ticketsquare-refund:${job.id}`;
  function match(
    raw: unknown,
    job: RefundJob,
    transactionId?: number,
  ): RefundResult {
    const r = refund.parse(raw),
      t = r.transaction;
    if (
      r.amount.toString() !== job.amount ||
      r.currency !== job.currency ||
      r.merchant_note !== marker(job) ||
      (typeof t === "number"
        ? t !== transactionId
        : t.reference !== job.reference ||
          t.amount.toString() !== job.amount ||
          t.currency !== job.currency ||
          (transactionId !== undefined && t.id !== transactionId))
    )
      throw new Error("Refund does not match approval");
    return { id: String(r.id), status: r.status };
  }
  return {
    async inspect(job) {
      if (!/^[A-Za-z0-9.=-]{1,100}$/.test(job.reference))
        throw new Error("Invalid reference");
      const verified = z
        .object({
          status: z.literal(true),
          data: transaction.extend({ status: z.string() }),
        })
        .parse(
          await request(
            `/transaction/verify/${encodeURIComponent(job.reference)}`,
          ),
        ).data;
      if (
        verified.reference !== job.reference ||
        verified.amount.toString() !== job.amount ||
        verified.currency !== job.currency
      )
        throw new Error("Transaction mismatch");
      const list = z
        .object({
          status: z.literal(true),
          data: z.array(z.unknown()).max(100),
          meta: z.object({ total: z.number().int().nonnegative() }).optional(),
        })
        .parse(
          await request(
            `/refund?transaction=${verified.id}&perPage=100&page=1`,
          ),
        );
      // A full page or inconsistent metadata cannot establish that the list is complete.
      if (
        list.data.length === 100 ||
        (list.meta && list.meta.total !== list.data.length) ||
        list.data.length > 1
      )
        throw new Error("Refund history requires review");
      if (!list.data.length) {
        if (verified.status !== "success")
          throw new Error("Transaction is not refundable");
        return null;
      }
      const found = match(list.data[0], job, verified.id);
      const detail = z
        .object({ status: z.literal(true), data: z.unknown() })
        .parse(await request(`/refund/${found.id}`));
      const checked = match(detail.data, job, verified.id);
      if (checked.id !== found.id) throw new Error("Refund identity mismatch");
      return checked;
    },
    async create(job) {
      const amount = integer.parse(Number(job.amount));
      if (String(amount) !== job.amount) throw new Error("Invalid amount");
      const result = z
        .object({ status: z.literal(true), data: z.unknown() })
        .parse(
          await request("/refund", {
            transaction: job.reference,
            amount,
            currency: job.currency,
            merchant_note: marker(job),
            customer_note: "Full ticket payment refund",
          }),
        );
      return match(result.data, job);
    },
  };
}
