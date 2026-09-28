"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
export type EventFormValue = {
  name: string;
  slug: string;
  description: string;
  venue: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  reservationMinutes: number;
  artworkUrl: string;
};
const blank: EventFormValue = {
  name: "",
  slug: "",
  description: "",
  venue: "",
  timezone: "Africa/Lagos",
  startsAt: "",
  endsAt: "",
  reservationMinutes: 10,
  artworkUrl: "",
};
export function EventForm({
  id,
  initial = blank,
}: {
  id?: string;
  initial?: EventFormValue;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const response = await fetch(
        id ? `/api/admin/events/${id}` : "/api/admin/events",
        {
          method: id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values,
            reservationMinutes: Number(values.reservationMinutes),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      router.push(`/admin/events/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <div className="form-grid">
        <label>
          Event name
          <input
            name="name"
            defaultValue={initial.name}
            required
            maxLength={200}
          />
        </label>
        <label>
          Public URL slug
          <input
            name="slug"
            defaultValue={initial.slug}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={160}
          />
          <small>Lowercase words separated by hyphens.</small>
        </label>
      </div>
      <label>
        Description
        <textarea
          name="description"
          defaultValue={initial.description}
          rows={5}
          maxLength={10000}
        />
      </label>
      <label>
        Venue and location
        <input
          name="venue"
          defaultValue={initial.venue}
          required
          maxLength={500}
        />
      </label>
      <label>
        Artwork URL (optional)
        <input
          type="url"
          name="artworkUrl"
          defaultValue={initial.artworkUrl}
          placeholder="https://…"
          maxLength={2000}
        />
        <small>Use an HTTPS image you have permission to publish.</small>
      </label>
      <div className="form-grid">
        <label>
          Event timezone
          <input
            name="timezone"
            defaultValue={initial.timezone}
            required
            list="timezones"
          />
          <datalist id="timezones">
            <option value="Africa/Lagos" />
            <option value="Europe/London" />
            <option value="America/New_York" />
          </datalist>
        </label>
        <label>
          Reservation duration (minutes)
          <input
            type="number"
            name="reservationMinutes"
            min={1}
            max={1440}
            defaultValue={initial.reservationMinutes}
            required
          />
          <small>
            Applies to new orders only. Between 1 minute and 24 hours.
          </small>
        </label>
        <label>
          Starts at (event local time)
          <input
            type="datetime-local"
            name="startsAt"
            defaultValue={initial.startsAt}
            required
          />
        </label>
        <label>
          Ends at (optional)
          <input
            type="datetime-local"
            name="endsAt"
            defaultValue={initial.endsAt}
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : id ? "Save event" : "Create draft"}
      </button>
    </form>
  );
}
