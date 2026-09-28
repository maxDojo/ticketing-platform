import { expect, it } from "vitest";
import {
  localToInstant,
  toMinorUnits,
  eventInput,
  availability,
} from "./validation";
it("converts Lagos wall time independently of server timezone", () => {
  expect(localToInstant("2026-12-19T18:00", "Africa/Lagos").toISOString()).toBe(
    "2026-12-19T17:00:00.000Z",
  );
});
it("rejects ambiguous and nonexistent local times", () => {
  expect(() =>
    localToInstant("2026-11-01T01:30", "America/New_York"),
  ).toThrow();
  expect(() =>
    localToInstant("2026-03-08T02:30", "America/New_York"),
  ).toThrow();
});
it("converts money without floating-point rounding", () => {
  expect(toMinorUnits("12500.01")).toBe(1250001n);
  expect(toMinorUnits("0.1")).toBe(10n);
});
it("rejects executable artwork URLs and extra privilege fields", () => {
  const value = {
    name: "Event",
    slug: "event",
    description: "",
    venue: "Lagos",
    timezone: "Africa/Lagos",
    startsAt: "2026-12-19T18:00",
    endsAt: "",
    reservationMinutes: 10,
    artworkUrl: "javascript:alert(1)",
  };
  expect(eventInput.safeParse(value).success).toBe(false);
  expect(
    eventInput.safeParse({
      ...value,
      artworkUrl: "",
      organizerId: "someone-else",
    }).success,
  ).toBe(false);
});
it("distinguishes not-started, sold out and ended ticket categories", () => {
  const t = {
    capacity: 1,
    reservedUnits: 1,
    soldUnits: 0,
    active: true,
    saleStartsAt: null,
    saleEndsAt: null,
  };
  expect(availability(t)).toBe("Sold out");
  expect(
    availability(
      { ...t, saleStartsAt: new Date("2030-01-01") },
      new Date("2026-01-01"),
    ),
  ).toBe("Sales not started");
  expect(
    availability(
      { ...t, saleEndsAt: new Date("2025-01-01") },
      new Date("2026-01-01"),
    ),
  ).toBe("Sales ended");
});
