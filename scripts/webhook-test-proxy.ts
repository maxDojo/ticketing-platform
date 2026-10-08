import { loadEnvConfig } from "@next/env";
import { paymentConfig } from "../src/config/payments";
import { createTestWebhookProxy } from "../src/modules/payments/test-webhook-proxy";

loadEnvConfig(process.cwd());
try {
  const config = paymentConfig(process.env);
  if (!config) throw new Error("Test payments required");
  const server = createTestWebhookProxy(config.secret);
  server.on("error", () => {
    console.error("Webhook test proxy could not start.");
    process.exitCode = 1;
  });
  server.listen(3400, "127.0.0.1", () => {
    console.log(
      "Local webhook-only proxy: http://127.0.0.1:3400/api/paystack/webhook",
    );
    console.log("No public tunnel started. Press Ctrl+C to stop.");
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
} catch {
  console.error("Webhook proxy requires valid test payment configuration.");
  process.exitCode = 1;
}
