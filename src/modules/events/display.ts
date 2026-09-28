import { Temporal } from "@js-temporal/polyfill";
export function localDateValue(value: Date | null, timezone: string) {
  return value
    ? Temporal.Instant.fromEpochMilliseconds(value.getTime())
        .toZonedDateTimeISO(timezone)
        .toPlainDateTime()
        .toString({ smallestUnit: "minute" })
    : "";
}
