import { expect, it } from "vitest";
import { csv, csvCell } from "./csv";
import { reportInput } from "./input";
it("neutralizes formula prefixes including whitespace, control characters and full-width variants", () => {
  for (const value of [
    "=1+1",
    "+SUM(A1)",
    "-2+3",
    "@SUM(A1)",
    "  =1+1",
    "\tplain",
    "\r=1",
    "\n=1",
    "＝1+1",
    "＋1",
    "－2",
    "＠SUM(A1)",
  ])
    expect(csvCell(value)).toBe('"Text: ' + value + '"');
  expect(csvCell("Normal buyer")).toBe('"Normal buyer"');
  expect(csvCell("100000")).toBe('"100000"');
});
it("quotes embedded delimiters and quotes and preserves rows without credentials", () => {
  expect(
    csv(
      [{ name: 'A, "B"', amount: "12345678901234567890", extra: "secret" }],
      ["name", "amount"],
    ),
  ).toBe('\ufeff"name","amount"\r\n"A, ""B""","12345678901234567890"\r\n');
  expect(csvCell(null)).toBe('""');
});
it("rejects incompatible filters, unbounded pages and unexpected inputs", () => {
  for (const value of [
    { kind: "orders", status: "checked_in" },
    { kind: "admissions", status: "paid" },
    { page: 0 },
    { page: 2001 },
    { page: 1.5 },
    { search: "a".repeat(201) },
    { token: "secret" },
  ])
    expect(reportInput.safeParse(value).success).toBe(false);
  expect(
    reportInput.safeParse({ kind: "admissions", status: "not_checked_in" })
      .success,
  ).toBe(true);
});
