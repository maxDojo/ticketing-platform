export const DEFAULT_RESERVATION_MINUTES = 10;
export const MAX_RESERVATION_MINUTES = 1440;

// Capture the organizer setting once; existing holds never read it again.
export function reservationSnapshot(reservedAt: Date, minutes: number) {
  if (
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > MAX_RESERVATION_MINUTES ||
    !Number.isFinite(reservedAt.getTime())
  ) {
    throw new Error("Invalid reservation duration or start time");
  }
  return {
    reservationMinutes: minutes,
    reservedAt: new Date(reservedAt),
    reservationExpiresAt: new Date(reservedAt.getTime() + minutes * 60000),
  };
}
