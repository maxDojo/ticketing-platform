"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
type Ticket = {
  id: string;
  reference: string;
  status: string;
  category: string;
  buyer_name: string;
  order_reference: string;
  admission_ordinal: number;
  checked_in_at: string | null;
};
type View = {
  admitted: number;
  tickets: Ticket[];
  recent: {
    reference: string;
    category: string;
    method: string;
    created_at: string;
    actor: string;
  }[];
};
type Result = {
  outcome: "admitted" | "already_checked_in" | "invalid";
  reference?: string;
  category?: string;
  checkedInAt?: string;
};
export function Gate({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [view, setView] = useState<View | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  function stop() {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setScanning(false);
  }
  useEffect(() => {
    const lifecycle = generation;
    const stopHidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", stopHidden);
    return () => {
      lifecycle.current++;
      if (timer.current) clearTimeout(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      document.removeEventListener("visibilitychange", stopHidden);
    };
  }, []);
  async function call(body: object) {
    const response = await fetch(`/api/staff/events/${eventId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to verify.");
    return data;
  }
  async function lookup(search?: string) {
    stop();
    setResult(null);
    setError("");
    setSelected(null);
    setView(null);
    setBusy(true);
    try {
      setView(await call({ action: "lookup", ...(search ? { search } : {}) }));
    } catch {
      setError(
        "Unable to load admissions. Check your connection and staff session.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function admit(body: object) {
    if (inFlight.current) return;
    inFlight.current = true;
    stop();
    setResult(null);
    setError("");
    setBusy(true);
    setSelected(null);
    setView(null);
    try {
      setResult(await call(body));
    } catch {
      setError(
        "Unable to confirm admission. Do not admit on this result. Reconnect and scan the same ticket again; if it was recorded, the server will show already checked in.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function start() {
    stop();
    setResult(null);
    setError("");
    setSelected(null);
    setScanning(true);
    const current = generation.current;
    try {
      const { default: decode } = await import("jsqr");
      if (current !== generation.current) return;
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 640 } },
        audio: false,
      });
      if (current !== generation.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const frame = () => {
        if (current !== generation.current) return;
        try {
          const v = video.current!;
          if (v.readyState >= 2 && v.videoWidth) {
            canvas.width = Math.min(640, v.videoWidth);
            canvas.height = Math.max(
              1,
              Math.round((v.videoHeight * canvas.width) / v.videoWidth),
            );
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qr = decode(pixels.data, pixels.width, pixels.height);
            if (qr) {
              stop();
              if (!/^tsq_test_v1_[A-Za-z0-9_-]{43}$/.test(qr.data)) {
                setError("This is not a TicketSquare test admission QR.");
                return;
              }
              void admit({ method: "qr", token: qr.data });
              return;
            }
          }
          timer.current = setTimeout(frame, 250);
        } catch {
          stop();
          setError("Camera unavailable. Try again or use manual lookup.");
        }
      };
      frame();
    } catch {
      if (current === generation.current) {
        stop();
        setError(
          "Camera unavailable. Allow camera access on HTTPS or localhost, or use manual lookup.",
        );
      }
    }
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void lookup(
      String(new FormData(event.currentTarget).get("search") ?? "").trim(),
    );
  }
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Staff · test mode</p>
        <h1>{eventName}</h1>
        <p>
          One ticket, one admission. Group members can arrive separately. An
          online server response is required.
        </p>
      </div>
      <section className="panel stack" aria-label="QR scanner">
        <h2>Scan an admission</h2>
        <p>
          Scanning a valid QR immediately records check-in. Camera images stay
          on this device.
        </p>
        <video
          ref={video}
          muted
          playsInline
          className="gate-video"
          hidden={!scanning}
          aria-label="Ticket scanning camera"
        />
        {scanning ? (
          <button className="button" onClick={stop}>
            Stop camera
          </button>
        ) : (
          <button
            className="button"
            disabled={busy}
            onClick={() => void start()}
          >
            Start camera
          </button>
        )}
        {busy && <p role="status">Waiting for the server…</p>}
        {result && (
          <div
            role="status"
            className={`gate-result ${result.outcome === "admitted" ? "gate-success" : "gate-warning"}`}
          >
            <h2>
              {result.outcome === "admitted"
                ? "Admitted — test check-in recorded"
                : result.outcome === "already_checked_in"
                  ? "Already checked in — do not admit again"
                  : "Invalid ticket — do not admit"}
            </h2>
            {result.reference && (
              <p>
                {result.category} · {result.reference}
              </p>
            )}
            {result.checkedInAt && (
              <p>{new Date(result.checkedInAt).toLocaleString()}</p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </section>
      <section className="panel stack">
        <h2>Manual lookup</h2>
        <p>
          Search by buyer name, exact buyer email, order reference or ticket
          reference. The buyer may hold tickets for other people.
        </p>
        <form className="stack" onSubmit={search}>
          <label>
            Buyer or reference
            <input
              name="search"
              minLength={3}
              maxLength={200}
              required
              autoComplete="off"
            />
          </label>
          <button className="button" disabled={busy || scanning}>
            Search admissions
          </button>
        </form>
        {view && (
          <>
            <p>
              {view.admitted} admissions checked in. Up to 50 search results
              shown; narrow your search if needed.
            </p>
            {view.tickets.map((t) => (
              <article className="panel stack" key={t.id}>
                <h3>
                  {t.buyer_name} · {t.category} · Admission{" "}
                  {t.admission_ordinal}
                </h3>
                <p>{t.reference}</p>
                <p>Order: {t.order_reference}</p>
                <p>{t.checked_in_at ? "Already checked in" : t.status}</p>
                <button
                  className="button"
                  disabled={
                    busy ||
                    scanning ||
                    !!t.checked_in_at ||
                    t.status !== "valid"
                  }
                  onClick={() => {
                    stop();
                    setResult(null);
                    setSelected(t);
                  }}
                >
                  Review manual check-in
                </button>
              </article>
            ))}
          </>
        )}
        {selected && (
          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(
                new FormData(e.currentTarget).get("reason") ?? "",
              );
              void admit({ method: "manual", ticketId: selected.id, reason });
            }}
          >
            <h3>Confirm this admission</h3>
            <p>
              {selected.buyer_name} · {selected.category} · Admission{" "}
              {selected.admission_ordinal}
            </p>
            <p>{selected.reference}</p>
            <p>
              Verify entitlement with the buyer or supervisor. This action
              admits one person and cannot be undone here.
            </p>
            <label>
              Reason for manual check-in
              <input
                name="reason"
                minLength={5}
                maxLength={200}
                required
                placeholder="For example: damaged QR, verified by supervisor"
              />
            </label>
            <button className="button" disabled={busy}>
              Confirm manual admission
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
          </form>
        )}
      </section>
      <section className="panel stack">
        <h2>Recent check-ins</h2>
        <button
          className="text-button"
          disabled={busy || scanning}
          onClick={() => void lookup()}
        >
          Refresh check-in history
        </button>
        {view?.recent.map((r) => (
          <article key={r.reference}>
            <p>
              {r.category} · {r.reference}
            </p>
            <p>
              {r.actor} · {r.method} · {new Date(r.created_at).toLocaleString()}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
