import { describe, it, expect, vi } from "vitest";
import { paystackRefunds } from "./provider";
const job = {
  id: "refund-id",
  reference: "ts-test-payment",
  amount: "100000",
  currency: "NGN",
};
const txn = {
  id: 42,
  reference: job.reference,
  domain: "test",
  amount: 100000,
  currency: "NGN",
};
const refund = {
  id: 7,
  transaction: 42,
  domain: "test",
  amount: 100000,
  currency: "NGN",
  merchant_note: "ticketsquare-refund:refund-id",
  status: "processed",
};
function fake(values: unknown[]) {
  return vi.fn(async () =>
    Response.json(values.shift()),
  ) as unknown as typeof fetch;
}
it("verifies transaction then lists by numeric transaction ID and fetches the matching refund", async () => {
  const transport = fake([
    { status: true, data: txn },
    { status: true, data: [refund] },
    { status: true, data: refund },
  ]);
  expect(
    await paystackRefunds("sk_test_synthetic12345", transport).inspect(job),
  ).toEqual({ id: "7", status: "processed" });
  expect(transport).toHaveBeenNthCalledWith(
    2,
    "https://api.paystack.co/refund?transaction=42&perPage=100&page=1",
    expect.objectContaining({ redirect: "error", method: "GET" }),
  );
});
it("creates only the exact full amount with an opaque marker and no internal reason", async () => {
  const transport = fake([
    { status: true, data: { ...refund, transaction: txn, status: "pending" } },
  ]);
  expect(
    await paystackRefunds("sk_test_synthetic12345", transport).create(job),
  ).toEqual({ id: "7", status: "pending" });
  expect(transport).toHaveBeenCalledWith(
    "https://api.paystack.co/refund",
    expect.objectContaining({
      body: JSON.stringify({
        transaction: job.reference,
        amount: 100000,
        currency: "NGN",
        merchant_note: "ticketsquare-refund:refund-id",
        customer_note: "Full ticket payment refund",
      }),
    }),
  );
});
describe.each([
  { domain: "live" },
  { amount: 100 },
  { currency: "USD" },
  { transaction: 43 },
  { merchant_note: "manual refund" },
  { id: 1.5 },
  { reversed_at: "2026-10-01" },
])("rejects mismatched or reversed refunds %j", (patch) => {
  it("does not accept the status", async () => {
    const transport = fake([
      { status: true, data: txn },
      { status: true, data: [{ ...refund, ...patch }] },
    ]);
    await expect(
      paystackRefunds("sk_test_synthetic12345", transport).inspect(job),
    ).rejects.toThrow();
  });
});
it("rejects partial history, multiple refunds and unknown metadata totals", async () => {
  for (const response of [
    { data: [refund, refund] },
    { data: [], meta: { total: 1 } },
    { data: Array(100).fill(refund) },
  ]) {
    await expect(
      paystackRefunds(
        "sk_test_synthetic12345",
        fake([
          { status: true, data: txn },
          { status: true, ...response },
        ]),
      ).inspect(job),
    ).rejects.toThrow();
  }
});
it("rejects live credentials and oversized responses", async () => {
  expect(() => paystackRefunds("sk_live_synthetic12345")).toThrow();
  await expect(
    paystackRefunds(
      "sk_test_synthetic12345",
      vi.fn(async () => new Response("x".repeat(131073))),
    ).inspect(job),
  ).rejects.toThrow("Invalid refund response");
});
