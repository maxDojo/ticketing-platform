"use client";
import { useState, type FormEvent } from "react";
export type TicketFormValue = {
  id?: string;
  name: string;
  description: string;
  price: string;
  capacity: number;
  admissionsPerUnit: number;
  minimumQuantity: number;
  maximumQuantity: number;
  saleStartsAt: string;
  saleEndsAt: string;
  active: boolean;
};
const blank: TicketFormValue = {
  name: "",
  description: "",
  price: "0.00",
  capacity: 100,
  admissionsPerUnit: 1,
  minimumQuantity: 1,
  maximumQuantity: 10,
  saleStartsAt: "",
  saleEndsAt: "",
  active: true,
};
export function TicketForm({
  eventId,
  initial = blank,
}: {
  eventId: string;
  initial?: TicketFormValue;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const v = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const response = await fetch(
        `/api/admin/events/${eventId}/ticket-types${initial.id ? `/${initial.id}` : ""}`,
        {
          method: initial.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...v,
            capacity: Number(v.capacity),
            admissionsPerUnit: Number(v.admissionsPerUnit),
            minimumQuantity: Number(v.minimumQuantity),
            maximumQuantity: Number(v.maximumQuantity),
            active: v.active === "on",
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Ticket name
          <input
            name="name"
            defaultValue={initial.name}
            required
            maxLength={200}
          />
        </label>
        <label>
          Price per unit (₦)
          <input
            name="price"
            inputMode="decimal"
            defaultValue={initial.price}
            required
            pattern="(0|[1-9][0-9]*)(\.[0-9]{1,2})?"
          />
        </label>
      </div>
      <label>
        Ticket description
        <textarea
          name="description"
          defaultValue={initial.description}
          maxLength={2000}
        />
      </label>
      <div className="form-grid">
        <label>
          Capacity (units/packages)
          <input
            name="capacity"
            type="number"
            min={0}
            max={1000000}
            defaultValue={initial.capacity}
            required
          />
        </label>
        <label>
          People admitted per unit
          <input
            name="admissionsPerUnit"
            type="number"
            min={1}
            max={1000}
            defaultValue={initial.admissionsPerUnit}
            required
          />
          <small>Each person receives a separate ticket.</small>
        </label>
        <label>
          Minimum units per order
          <input
            name="minimumQuantity"
            type="number"
            min={1}
            max={10000}
            defaultValue={initial.minimumQuantity}
            required
          />
        </label>
        <label>
          Maximum units per order
          <input
            name="maximumQuantity"
            type="number"
            min={1}
            max={10000}
            defaultValue={initial.maximumQuantity}
            required
          />
        </label>
        <label>
          Sales start (event local time)
          <input
            name="saleStartsAt"
            type="datetime-local"
            defaultValue={initial.saleStartsAt}
          />
        </label>
        <label>
          Sales end (event local time)
          <input
            name="saleEndsAt"
            type="datetime-local"
            defaultValue={initial.saleEndsAt}
          />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" name="active" defaultChecked={initial.active} />
        Active
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : initial.id ? "Save ticket type" : "Add ticket type"}
      </button>
    </form>
  );
}
export function PublishButton({
  id,
  published,
}: {
  id: string;
  published: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch(`/api/admin/events/${id}/publish`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publish: !published }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            window.location.reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not publish.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Please wait…"
          : published
            ? "Unpublish event"
            : "Publish event"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
