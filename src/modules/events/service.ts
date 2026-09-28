import "server-only";
import { and, eq, desc } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { events, ticketTypes, adminAudit } from "@/db/schema";
import { requireOrganizer, AccessError } from "@/modules/auth/access";
import {
  eventInput,
  ticketInput,
  localToInstant,
  toMinorUnits,
} from "./validation";
import { z } from "zod";
const validId = (id: string) => {
  if (!z.uuid().safeParse(id).success)
    throw new AccessError(404, "Event not found.");
};
export async function listEvents(headers: Headers) {
  const actor = await requireOrganizer(headers);
  return getDatabase()
    .select()
    .from(events)
    .where(eq(events.organizerId, actor.userId))
    .orderBy(desc(events.createdAt));
}
export async function getManagedEvent(headers: Headers, id: string) {
  const actor = await requireOrganizer(headers);
  validId(id);
  const [event] = await getDatabase()
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.organizerId, actor.userId)));
  if (!event) throw new AccessError(404, "Event not found.");
  const types = await getDatabase()
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, id))
    .orderBy(ticketTypes.createdAt);
  return { event, types };
}
export async function saveEvent(headers: Headers, input: unknown, id?: string) {
  const actor = await requireOrganizer(headers);
  if (id) validId(id);
  const parsed = eventInput.safeParse(input);
  if (!parsed.success)
    throw new AccessError(
      400,
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" "),
    );
  const v = parsed.data;
  const values = {
    ...v,
    startsAt: localToInstant(v.startsAt, v.timezone),
    endsAt: v.endsAt ? localToInstant(v.endsAt, v.timezone) : null,
    artworkUrl: v.artworkUrl || null,
  };
  try {
    return await getDatabase().transaction(async (tx) => {
      let saved;
      if (id) {
        const [existing] = await tx
          .select()
          .from(events)
          .where(and(eq(events.id, id), eq(events.organizerId, actor.userId)))
          .for("update");
        if (!existing) throw new AccessError(404, "Event not found.");
        [saved] = await tx
          .update(events)
          .set(values)
          .where(eq(events.id, id))
          .returning();
      } else {
        [saved] = await tx
          .insert(events)
          .values({ ...values, organizerId: actor.userId })
          .returning();
      }
      await tx.insert(adminAudit).values({
        actorId: actor.userId,
        action: id ? "EVENT_UPDATED" : "EVENT_CREATED",
        resourceId: saved!.id,
      });
      return saved!.id;
    });
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError(
      409,
      "Unable to save. Check the event slug is unique and the details are valid.",
    );
  }
}
export async function saveTicketType(
  headers: Headers,
  eventId: string,
  input: unknown,
  id?: string,
) {
  const actor = await requireOrganizer(headers);
  validId(eventId);
  if (id) validId(id);
  const parsed = ticketInput.safeParse(input);
  if (!parsed.success)
    throw new AccessError(
      400,
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(" "),
    );
  const v = parsed.data;
  return getDatabase().transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.organizerId, actor.userId)))
      .for("update");
    if (!event) throw new AccessError(404, "Event not found.");
    let start: Date | null;
    let end: Date | null;
    try {
      start = v.saleStartsAt
        ? localToInstant(v.saleStartsAt, event.timezone)
        : null;
      end = v.saleEndsAt ? localToInstant(v.saleEndsAt, event.timezone) : null;
    } catch {
      throw new AccessError(
        400,
        "Invalid or ambiguous sale time in the event timezone.",
      );
    }
    if (start && end && end <= start)
      throw new AccessError(400, "Sale end must be after sale start.");
    const { price, ...fields } = v;
    const values = {
      ...fields,
      eventId,
      unitPrice: toMinorUnits(price),
      currency: "NGN",
      saleStartsAt: start,
      saleEndsAt: end,
    };
    let saved;
    if (id) {
      const [existing] = await tx
        .select()
        .from(ticketTypes)
        .where(and(eq(ticketTypes.id, id), eq(ticketTypes.eventId, eventId)))
        .for("update");
      if (!existing) throw new AccessError(404, "Ticket type not found.");
      if (v.capacity < existing.reservedUnits + existing.soldUnits)
        throw new AccessError(
          409,
          "Capacity cannot be below sold and reserved units.",
        );
      [saved] = await tx
        .update(ticketTypes)
        .set(values)
        .where(and(eq(ticketTypes.id, id), eq(ticketTypes.eventId, eventId)))
        .returning();
    } else {
      [saved] = await tx.insert(ticketTypes).values(values).returning();
    }
    await tx.insert(adminAudit).values({
      actorId: actor.userId,
      action: id ? "TICKET_TYPE_UPDATED" : "TICKET_TYPE_CREATED",
      resourceId: saved!.id,
    });
    return saved!.id;
  });
}
export async function publishEvent(
  headers: Headers,
  id: string,
  publish: boolean,
) {
  const actor = await requireOrganizer(headers);
  validId(id);
  await getDatabase().transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(events)
      .where(and(eq(events.id, id), eq(events.organizerId, actor.userId)))
      .for("update");
    if (!event) throw new AccessError(404, "Event not found.");
    if (publish) {
      const types = await tx
        .select()
        .from(ticketTypes)
        .where(and(eq(ticketTypes.eventId, id), eq(ticketTypes.active, true)));
      if (
        !types.length ||
        !event.description.trim() ||
        event.startsAt <= new Date()
      )
        throw new AccessError(
          400,
          "Add a description, a future start time, and an active ticket type before publishing.",
        );
    }
    await tx
      .update(events)
      .set({ status: publish ? "published" : "draft" })
      .where(eq(events.id, id));
    await tx.insert(adminAudit).values({
      actorId: actor.userId,
      action: publish ? "EVENT_PUBLISHED" : "EVENT_UNPUBLISHED",
      resourceId: id,
    });
  });
}
export async function publicEvent(slug: string) {
  const [event] = await getDatabase()
    .select({
      id: events.id,
      name: events.name,
      slug: events.slug,
      description: events.description,
      venue: events.venue,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      artworkUrl: events.artworkUrl,
    })
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.status, "published")));
  if (!event) return null;
  const types = await getDatabase()
    .select()
    .from(ticketTypes)
    .where(and(eq(ticketTypes.eventId, event.id), eq(ticketTypes.active, true)))
    .orderBy(ticketTypes.createdAt);
  return { event, types };
}
