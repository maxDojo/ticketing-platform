import { z } from "zod";
export class OrderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const orderInput = z
  .object({
    eventId: z.uuid().transform((v) => v.toLowerCase()),
    requestKey: z.uuid().transform((v) => v.toLowerCase()),
    buyerName: z.string().trim().min(1).max(200),
    buyerEmail: z.email().trim().toLowerCase().max(320),
    buyerPhone: z
      .string()
      .trim()
      .max(32)
      .regex(/^[+\d ()-]*$/)
      .optional(),
    items: z
      .array(
        z
          .object({
            ticketTypeId: z.uuid().transform((v) => v.toLowerCase()),
            quantity: z.number().int().min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.ticketTypeId)).size !== v.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Choose each category only once.",
      });
  });
export type OrderInput = z.infer<typeof orderInput>;
