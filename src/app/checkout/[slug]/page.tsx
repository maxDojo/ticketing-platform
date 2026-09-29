import { paymentConfig } from "@/config/payments";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { publicEvent } from "@/modules/events/service";
import { Brand } from "@/components/brand";
import { CheckoutForm } from "@/components/checkout/form";
import { availability } from "@/modules/events/validation";
export default async function Checkout({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await connection();
  const { slug } = await params;
  const data = await publicEvent(slug);
  if (!data) notFound();
  return (
    <>
      <header className="admin-header">
        <Brand />
        <Link href={`/events/${slug}`}>Back to event</Link>
      </header>
      <main id="main" className="workspace stack">
        <p className="eyebrow">Your next experience</p>
        <h1>{data.event.name}</h1>
        <p className="notice">
          Test preview only. Reservations and test payments do not grant
          admission.
        </p>
        <CheckoutForm
          eventId={data.event.id}
          testPaymentsEnabled={!!paymentConfig(process.env)}
          types={data.types.map((t) => ({
            id: t.id,
            name: t.name,
            price: t.unitPrice.toString(),
            admissions: t.admissionsPerUnit,
            minimum: t.minimumQuantity,
            maximum: Math.min(
              t.maximumQuantity,
              t.capacity - t.reservedUnits - t.soldUnits,
            ),
            available:
              availability(t) === "Available" &&
              data.event.startsAt > new Date(),
          }))}
        />
      </main>
    </>
  );
}
