import { test, expect } from "@playwright/test";

test("renders the responsive foundation without browser or CSP errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your next experience.",
  );
  await expect(
    page.getByText("Ticket sales are not open yet.", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-powered-by"]).toBeUndefined();
  expect(errors).toEqual([]);
});

test("issues fresh nonces and overrides attacker-provided security headers", async ({
  request,
}) => {
  const first = await request.get("/", {
    headers: {
      "x-nonce": "attacker-chosen",
      "Content-Security-Policy": "script-src * 'unsafe-inline'",
    },
  });
  const second = await request.get("/");
  const policy = first.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).not.toContain("attacker-chosen");
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toBe(second.headers()["content-security-policy"]);
  expect(await first.text()).toContain(`nonce="${nonce}"`);
});
