"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AuthForm } from "./auth-form";
export function AccountSecurity({ staff = false }: { staff?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [verify, setVerify] = useState(false);
  async function call(path: string, body: object) {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw Error(
        response.status === 429
          ? "Too many attempts. Wait 15 minutes before retrying."
          : response.status === 401
            ? "Your session has expired. Sign in again."
            : "Unable to complete the request. Check your current password and session, then try again.",
      );
  }
  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setError("");
    setMessage("");
    if (data.get("newPassword") !== data.get("confirmPassword")) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await call("change-password", {
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
      });
      form.reset();
      setVerify(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Request failed. If it was interrupted, try signing in with your new password before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke(all: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await call(all ? "revoke-sessions" : "revoke-other-sessions", {});
      if (all) {
        router.replace(staff ? "/staff/sign-in" : "/admin/sign-in");
        router.refresh();
      } else
        setMessage(
          "Other sessions have been signed out. This browser remains signed in.",
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  if (verify)
    return (
      <div className="stack">
        <p role="status" className="notice">
          Password changed. Previous sessions have been signed out. Verify your
          authenticator to continue in this browser.
        </p>
        <AuthForm enrollment enabled staff={staff} />
      </div>
    );
  return (
    <div className="stack">
      <h1>Account security</h1>
      <p className="notice">
        Authenticator protection is enabled and this session is verified.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <form className="stack" onSubmit={changePassword}>
        <h2>Change password</h2>
        <p>
          Changing your password signs out previous sessions. You’ll verify your
          authenticator again in this browser.
        </p>
        <label>
          Current password
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          New password
          <input
            name="newPassword"
            aria-describedby="password-guidance"
            type="password"
            autoComplete="new-password"
            required
            minLength={14}
            maxLength={128}
          />
        </label>
        <small id="password-guidance">
          Use a unique password between 14 and 128 characters.
        </small>
        <label>
          Confirm new password
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={14}
            maxLength={128}
          />
        </label>
        <button className="button" disabled={busy}>
          Change password
        </button>
      </form>
      <section className="stack">
        <h2>Signed-in sessions</h2>
        <p>
          If you signed in on a shared device or no longer recognize a session,
          sign out other sessions. New sign-ins still require your password and
          authenticator.
        </p>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => revoke(false)}
        >
          Sign out other sessions
        </button>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void revoke(true);
          }}
        >
          <label>
            <input className="security-confirm" type="checkbox" required /> I
            understand this will also sign me out of this browser.
          </label>
          <button className="button secondary" disabled={busy}>
            Sign out everywhere
          </button>
        </form>
      </section>
      <section className="stack">
        <h2>Authenticator recovery</h2>
        <p>
          Keep your recovery codes private. If your authenticator is
          unavailable, choose “Use a recovery code” when signing in. Each
          recovery code works once. If you lose both your authenticator and
          recovery codes, contact the maintainer for verified account recovery.
        </p>
      </section>
    </div>
  );
}
