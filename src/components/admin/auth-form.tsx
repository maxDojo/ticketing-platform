"use client";
import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
async function call(path: string, body: object) {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Too many attempts. Please wait 15 minutes."
        : "Unable to verify. Check your details and try again.",
    );
  return data;
}
export function AuthForm({
  enrollment = false,
  enabled = false,
}: {
  enrollment?: boolean;
  enabled?: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState(
    enrollment ? (enabled ? "verify" : "enroll") : "password",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [backup, setBackup] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (phase === "password") {
        const result = await call("sign-in/email", {
          email: data.get("email"),
          password: data.get("password"),
          rememberMe: false,
        });
        if (result.twoFactorRedirect) setPhase("verify");
        else router.push("/admin/security");
      } else if (phase === "enroll") {
        const result = await call("two-factor/enable", {
          password: data.get("password"),
        });
        setQr(
          await QRCode.toDataURL(result.totpURI, { width: 240, margin: 2 }),
        );
        setCodes(result.backupCodes);
        setPhase("verify");
      } else {
        await call(
          backup ? "two-factor/verify-backup-code" : "two-factor/verify-totp",
          { code: data.get("code"), trustDevice: false },
        );
        router.push("/admin/events");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="stack">
      <h1>
        {phase === "password"
          ? "Welcome back"
          : phase === "enroll"
            ? "Protect your account"
            : "Verify your identity"}
      </h1>
      <p className="muted">
        {phase === "password"
          ? "Sign in to manage your events. Organizer accounts are invitation-only."
          : phase === "enroll"
            ? "An authenticator app is required before you can manage events."
            : "Enter your authenticator code to continue."}
      </p>
      {phase === "password" && (
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={320}
          />
        </label>
      )}
      {phase !== "verify" && (
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
      )}
      {qr && (
        <div className="stack">
          <p>
            Scan this QR with your authenticator app. Keep these recovery codes
            somewhere private before continuing.
          </p>
          {/* The QR is generated locally and contains no external resource. */}
          <Image
            unoptimized
            src={qr}
            alt="Authenticator setup QR code"
            width={240}
            height={240}
          />
          <ul className="recovery-codes">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
      )}
      {phase === "verify" && (
        <>
          <label>
            {backup ? "Recovery code" : "Authenticator code"}
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              required
              maxLength={100}
            />
          </label>
          <button
            className="text-button"
            type="button"
            onClick={() => setBackup(!backup)}
          >
            {backup ? "Use authenticator code" : "Use a recovery code"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy
          ? "Please wait…"
          : phase === "password"
            ? "Sign in"
            : phase === "enroll"
              ? "Set up authenticator"
              : "Verify and continue"}
      </button>
    </form>
  );
}
export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="text-button"
      onClick={async () => {
        await call("sign-out", {});
        router.push("/admin/sign-in");
      }}
    >
      Sign out
    </button>
  );
}
