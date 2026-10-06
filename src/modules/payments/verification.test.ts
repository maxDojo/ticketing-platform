import { it, expect, vi } from "vitest";
import { paystackVerifier, verifiedTransaction } from "./verification";
const secret = "sk_test_syntheticverify123";
const data = {
  reference: "ts-test-ref",
  status: "success",
  domain: "test",
  amount: 100000,
  currency: "NGN",
  fees: 1500,
};
it("verifies through a fixed provider endpoint and returns only required payment fields", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      status: true,
      data: {
        ...data,
        customer: { email: "private@example.test" },
        authorization: { authorization_code: "sensitive" },
      },
    }),
  );
  expect(await paystackVerifier(secret, transport)(data.reference)).toEqual(
    data,
  );
  expect(transport.mock.calls[0]![0]).toBe(
    "https://api.paystack.co/transaction/verify/ts-test-ref",
  );
  expect(transport.mock.calls[0]![1]?.redirect).toBe("error");
});
it("rejects unsupported keys, malformed amounts, unsuccessful envelopes and oversized responses", async () => {
  expect(() => paystackVerifier("sk_live_notallowed")).toThrow();
  expect(verifiedTransaction.safeParse({ ...data, amount: 1.5 }).success).toBe(
    false,
  );
  expect(
    verifiedTransaction.safeParse({
      ...data,
      amount: Number.MAX_SAFE_INTEGER + 1,
    }).success,
  ).toBe(false);
  await expect(
    paystackVerifier(
      secret,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ status: false, data })),
    )(data.reference),
  ).rejects.toThrow();
  await expect(
    paystackVerifier(
      secret,
      vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(66000))),
    )(data.reference),
  ).rejects.toThrow();
});
