import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
export function localToInstant(value: string, timezone: string) {
  return new Date(
    Temporal.PlainDateTime.from(value).toZonedDateTime(timezone, {
      disambiguation: "reject",
    }).epochMilliseconds,
  );
}
const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid timezone.");
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
export const eventInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    description: z.string().trim().max(10000),
    venue: z.string().trim().min(1).max(500),
    timezone,
    startsAt: localDate,
    endsAt: z.union([localDate, z.literal("")]),
    reservationMinutes: z.number().int().min(1).max(1440),
    artworkUrl: z.union([
      z.literal(""),
      z
        .string()
        .url()
        .max(2000)
        .refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && !url.username && !url.password;
        }),
    ]),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      const start = localToInstant(v.startsAt, v.timezone);
      const end = v.endsAt ? localToInstant(v.endsAt, v.timezone) : null;
      if (end && end <= start)
        ctx.addIssue({
          code: "custom",
          path: ["endsAt"],
          message: "End must be after start.",
        });
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "Date/time is invalid or ambiguous in this timezone.",
      });
    }
  });
export const ticketInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000),
    price: z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/),
    capacity: z.number().int().min(0).max(1000000),
    admissionsPerUnit: z.number().int().min(1).max(1000),
    minimumQuantity: z.number().int().min(1).max(10000),
    maximumQuantity: z.number().int().min(1).max(10000),
    saleStartsAt: z.union([localDate, z.literal("")]),
    saleEndsAt: z.union([localDate, z.literal("")]),
    active: z.boolean(),
  })
  .strict()
  .refine((v) => v.maximumQuantity >= v.minimumQuantity, {
    path: ["maximumQuantity"],
    message: "Maximum must be at least minimum.",
  });
export function toMinorUnits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function formatMoney(value: bigint) {
  return `₦${(value / 100n).toLocaleString("en-NG")}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function availability(
  t: {
    capacity: number;
    reservedUnits: number;
    soldUnits: number;
    active: boolean;
    saleStartsAt: Date | null;
    saleEndsAt: Date | null;
  },
  now = new Date(),
) {
  if (!t.active) return "Unavailable";
  if (t.saleStartsAt && now < t.saleStartsAt) return "Sales not started";
  if (t.saleEndsAt && now >= t.saleEndsAt) return "Sales ended";
  return t.capacity - t.reservedUnits - t.soldUnits > 0
    ? "Available"
    : "Sold out";
}
