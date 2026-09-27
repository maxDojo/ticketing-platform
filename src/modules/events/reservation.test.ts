import { expect, it } from "vitest";
import { reservationSnapshot } from "./reservation";
it("captures independent deadlines when organizer duration changes", () => {
  const now = new Date("2026-12-19T12:00:00Z");
  const first = reservationSnapshot(now, 10);
  const second = reservationSnapshot(now, 25);
  now.setUTCFullYear(2030);
  expect(first.reservationExpiresAt.toISOString()).toBe(
    "2026-12-19T12:10:00.000Z",
  );
  expect(second.reservationExpiresAt.toISOString()).toBe(
    "2026-12-19T12:25:00.000Z",
  );
  expect(first.reservedAt.getUTCFullYear()).toBe(2026);
});
it.each([0, -1, 1.5, 1441, NaN, Infinity])(
  "rejects unsafe duration %s",
  (minutes) => {
    expect(() => reservationSnapshot(new Date(), minutes)).toThrow();
  },
);
