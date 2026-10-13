import { expect, it } from "vitest";
import { drillConnection } from "../../scripts/restore-drill/config";

it.each(["localhost", "127.0.0.1", "[::1]"])(
  "permits an explicit loopback test connection on %s",
  (host) => {
    const value = `postgresql://synthetic:synthetic@${host}:5433/postgres`;
    expect(drillConnection(value).config.connectionString).toBe(value);
  },
);
it.each([
  undefined,
  "",
  "postgresql://synthetic:synthetic@production.example.test/postgres",
  "postgresql://localhost:synthetic@production.example.test/postgres",
  "postgresql://synthetic:synthetic@127.0.0.1/postgres?host=production.example.test",
  "https://synthetic:synthetic@localhost/postgres",
])("refuses unsafe or missing drill connection %s", (value) => {
  expect(() => drillConnection(value)).toThrow();
});
