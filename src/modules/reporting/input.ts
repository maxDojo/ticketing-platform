import { z } from "zod";
export const reportInput = z
  .object({
    kind: z.enum(["orders", "admissions"]).default("orders"),
    search: z.string().trim().max(200).default(""),
    status: z
      .enum([
        "all",
        "pending",
        "expired",
        "paid",
        "cancelled",
        "payment_exception",
        "refunded",
        "partially_refunded",
        "valid",
        "checked_in",
        "not_checked_in",
      ])
      .default("all"),
    page: z.number().int().min(1).max(2000).default(1),
    export: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    const allowed =
      v.kind === "orders"
        ? [
            "all",
            "pending",
            "expired",
            "paid",
            "cancelled",
            "payment_exception",
            "refunded",
            "partially_refunded",
          ]
        : [
            "all",
            "valid",
            "cancelled",
            "refunded",
            "checked_in",
            "not_checked_in",
          ];
    if (!allowed.includes(v.status))
      ctx.addIssue({
        code: "custom",
        message: "Invalid status for this report.",
      });
  });
export type ReportInput = z.infer<typeof reportInput>;
export class ReportError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
