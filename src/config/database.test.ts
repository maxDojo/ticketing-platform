import { expect, it } from "vitest";
import { databaseConfig } from "./database";
it("requires verified TLS for remote database connections", () => {
  expect(
    databaseConfig("postgresql://user:secret@db.example.com/ticketsquare").ssl,
  ).toEqual({ rejectUnauthorized: true });
});
it("allows plaintext only on loopback for local development", () => {
  expect(
    databaseConfig("postgresql://user:secret@127.0.0.1:5433/ticketsquare").ssl,
  ).toBe(false);
});
it.each([
  undefined,
  "secret-not-url",
  "https://db.example.com/db",
  "postgresql://user:secret@db.example.com/db?sslmode=no-verify",
  "postgresql://user:secret@db.example.com/db?sslmode=disable",
  "postgresql://user:secret@db.example.com/",
])("rejects invalid or overriding options without exposing input", (value) => {
  expect(() => databaseConfig(value)).toThrow(
    /^Invalid database configuration: DATABASE_URL$/,
  );
});
