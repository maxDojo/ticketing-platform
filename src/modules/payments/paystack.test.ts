import { expect, it, vi } from "vitest";
import { paymentConfig } from "../../config/payments";
import { paystackGateway, checkoutUrl } from "./paystack";
const secret = "sk_test_syntheticcredential123";
const input = {
  reference: "ts-test-ref",
  amount: "6000001",
  email: "buyer@example.test",
  callbackUrl: "http://127.0.0.1:3000/payments/return",
};
it("disables by default and refuses live or missing keys", () => {
  expect(paymentConfig({})).toBeNull();
  expect(() =>
    paymentConfig({
      PAYSTACK_MODE: "live",
      PAYSTACK_SECRET_KEY: "sk_live_placeholder",
    }),
  ).toThrow();
  expect(() => paymentConfig({ PAYSTACK_MODE: "test" })).toThrow();
  expect(() => paystackGateway("sk_live_placeholder")).toThrow();
});
it("sends the exact server amount with account-borne fees and validated destination", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      status: true,
      data: {
        reference: input.reference,
        authorization_url: "https://checkout.paystack.com/testcode",
      },
    }),
  );
  expect(await paystackGateway(secret, transport)(input)).toBe(
    "https://checkout.paystack.com/testcode",
  );
  const [url, options] = transport.mock.calls[0]!;
  expect(url).toBe("https://api.paystack.co/transaction/initialize");
  expect(options?.redirect).toBe("error");
  expect(JSON.parse(String(options?.body))).toEqual({
    email: input.email,
    amount: "6000001",
    currency: "NGN",
    reference: input.reference,
    callback_url: input.callbackUrl,
    channels: ["card", "bank_transfer"],
    bearer: "account",
  });
});
it("rejects mismatched references, oversized responses and unsafe redirects", async () => {
  for (const url of [
    "https://evil.example/test",
    "https://checkout.paystack.com.evil.example/test",
    "https://user:pass@checkout.paystack.com/test",
    "http://checkout.paystack.com/test",
    "https://checkout.paystack.com/test?redirect=evil",
  ])
    expect(() => checkoutUrl(url)).toThrow();
  await expect(
    paystackGateway(
      secret,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status: true,
          data: {
            reference: "wrong",
            authorization_url: "https://checkout.paystack.com/test",
          },
        }),
      ),
    )(input),
  ).rejects.toThrow();
  await expect(
    paystackGateway(
      secret,
      vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(33000))),
    )(input),
  ).rejects.toThrow();
});
it("propagates ambiguous provider failures without claiming failure or retrying", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new Error("network timeout"));
  await expect(paystackGateway(secret, transport)(input)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
