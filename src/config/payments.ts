export function paymentConfig(input: Record<string, string | undefined>) {
  const mode = input.PAYSTACK_MODE ?? "disabled";
  if (mode === "disabled") return null;
  if (
    mode !== "test" ||
    !/^sk_test_[A-Za-z0-9]{10,}$/.test(input.PAYSTACK_SECRET_KEY ?? "")
  )
    throw new Error(
      "Invalid payment configuration: test mode and a test secret are required",
    );
  return { secret: input.PAYSTACK_SECRET_KEY! };
}
