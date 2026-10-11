"use client";
import { useEffect, useState, type FormEvent } from "react";
type Kind = "orders" | "admissions";
type Filters = { kind: Kind; search: string; status: string; page: number };
type Data = {
  rows: Record<string, string | number | null>[];
  total: string;
  page: number;
  pageSize: number;
  summary: {
    refunds: {
      currency: string;
      processed_minor: string;
      refunded_sales_minor: string;
      unresolved_minor: string;
    }[];
    money: {
      currency: string;
      fulfilled_orders: string;
      gross_sales_minor: string;
      verified_payments: string;
      verified_collections_minor: string;
      recorded_fees_minor: string;
      missing_fee_payments: string;
    }[];
    attendance: {
      issued: string;
      checked_in: string;
      valid_not_checked_in: string;
      invalidated: string;
    };
    inventory: {
      id: string;
      name: string;
      capacity: number;
      reserved_units: number;
      sold_units: number;
      available_units: number;
      admissions_per_unit: number;
    }[];
    orderStates: { status: string; count: string }[];
  };
};
const initial: Filters = { kind: "orders", search: "", status: "all", page: 1 };
function money(value: string, currency: string) {
  const amount = BigInt(value);
  return `${currency} ${(amount / 100n).toLocaleString("en-NG")}.${(amount % 100n).toString().padStart(2, "0")}`;
}
async function request(eventId: string, body: object, signal?: AbortSignal) {
  const response = await fetch(`/api/admin/events/${eventId}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const error = await response.json();
    throw Error(error.error ?? "Report unavailable.");
  }
  return response;
}
export function Reports({ eventId }: { eventId: string }) {
  const [kind, setKind] = useState<Kind>("orders");
  const [status, setStatus] = useState("all");
  const [data, setData] = useState<Data | null>(null);
  const [applied, setApplied] = useState<Filters>(initial);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void request(eventId, initial, controller.signal)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Report unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [eventId]);
  async function load(filters: Filters) {
    setBusy(true);
    setError("");
    try {
      setData(await (await request(eventId, filters)).json());
      setApplied(filters);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report unavailable.");
    } finally {
      setBusy(false);
    }
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    void load({
      kind,
      status,
      search: String(new FormData(event.currentTarget).get("search") ?? ""),
      page: 1,
    });
  }
  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await request(eventId, { ...applied, export: true });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `ticketsquare-${eventId}-${applied.kind}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const statuses =
    kind === "orders"
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
  return (
    <div className="stack">
      <p>
        Test-mode reporting. Totals cover the whole event; filters apply to the
        list and export. Settlement reconciliation is not implemented.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data && (
        <>
          <section className="panel stack">
            <h2>Sales and payments</h2>
            <p>
              Fulfilled sales count each order once. Verified collections also
              include duplicate or unfulfilled charges. Recorded fees cover
              verified successful payments; these figures are not profit or
              settled funds.
            </p>
            {!data.summary.money.length && (
              <p>No fulfilled sales or verified payments yet.</p>
            )}
            {data.summary.refunds.map((r) => (
              <div key={r.currency}>
                <h3>Refunds ({r.currency})</h3>
                <p>
                  Confirmed refunds: {money(r.processed_minor, r.currency)} · of
                  fulfilled sales: {money(r.refunded_sales_minor, r.currency)}
                </p>
                <p>
                  Unresolved refund approvals:{" "}
                  {money(r.unresolved_minor, r.currency)}. Gross sales remain
                  historical totals; confirmed refunds are shown separately.
                </p>
              </div>
            ))}
            {data.summary.money.map((m) => (
              <article key={m.currency} className="report-metrics">
                <p>
                  <strong>Gross fulfilled sales</strong>
                  <br />
                  {money(m.gross_sales_minor, m.currency)} ·{" "}
                  {m.fulfilled_orders} orders
                </p>
                <p>
                  <strong>Verified collections</strong>
                  <br />
                  {money(m.verified_collections_minor, m.currency)} ·{" "}
                  {m.verified_payments} payments
                </p>
                <p>
                  <strong>Recorded processing fees</strong>
                  <br />
                  {money(m.recorded_fees_minor, m.currency)}
                  <br />
                  {m.missing_fee_payments} payments with fees not yet recorded
                </p>
              </article>
            ))}
            <p>
              Order states:{" "}
              {data.summary.orderStates
                .map((s) => `${s.status.replaceAll("_", " ")}: ${s.count}`)
                .join(" · ") || "No orders"}
            </p>
          </section>
          <section className="panel stack">
            <h2>Attendance and inventory</h2>
            <p>
              {data.summary.attendance.issued} issued admissions ·{" "}
              {data.summary.attendance.checked_in} checked in ·{" "}
              {data.summary.attendance.valid_not_checked_in} valid, not checked
              in · {data.summary.attendance.invalidated} invalidated
            </p>
            <p>
              Inventory below counts purchasable units/packages, not people.
              Issued admissions use the entitlement captured at purchase.
            </p>
            {data.summary.inventory.map((t) => (
              <p key={t.id}>
                <strong>{t.name}</strong>: {t.sold_units} sold ·{" "}
                {t.reserved_units} reserved · {t.available_units} available of{" "}
                {t.capacity} units · currently {t.admissions_per_unit}{" "}
                admissions per unit
              </p>
            ))}
          </section>
        </>
      )}
      <section className="panel stack">
        <h2>Orders and admissions</h2>
        <form className="stack" onSubmit={search}>
          <label htmlFor="report-kind">
            Report
            <select
              id="report-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                setStatus("all");
              }}
            >
              <option value="orders">Orders</option>
              <option value="admissions">Admissions</option>
            </select>
          </label>
          <label htmlFor="report-status">
            Status
            <select
              id="report-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buyer name, exact email or reference
            <input name="search" maxLength={200} autoComplete="off" />
          </label>
          <button className="button" disabled={busy}>
            Apply filters
          </button>
        </form>
        {busy && <p role="status">Loading report…</p>}
        {data && (
          <>
            <p>
              {data.total} matching {applied.kind}. Page {data.page}. Up to{" "}
              {data.pageSize} rows per page.
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void download()}
            >
              Export all matching {applied.kind} (CSV)
            </button>
            <p>
              Exports contain buyer contact information. Store privately and
              delete when no longer needed. Maximum 10,000 rows; exports include
              all matches, not just this page.
            </p>
            <div
              className="report-table"
              tabIndex={0}
              role="region"
              aria-label="Report results"
            >
              <table>
                <caption>
                  {applied.kind === "orders"
                    ? "Order report"
                    : "Admission report"}
                </caption>
                <thead>
                  <tr>
                    {(applied.kind === "orders"
                      ? [
                          "Reference",
                          "Buyer",
                          "Email",
                          "Status",
                          "Total",
                          "Created (UTC)",
                          "Issued",
                          "Checked in",
                        ]
                      : [
                          "Ticket",
                          "Buyer",
                          "Email",
                          "Order",
                          "Category",
                          "Admission",
                          "Status",
                          "Checked in (UTC)",
                          "Method",
                          "Staff",
                        ]
                    ).map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={String(row.reference)}>
                      {(applied.kind === "orders"
                        ? [
                            "reference",
                            "buyer_name",
                            "buyer_email",
                            "status",
                            "total_minor",
                            "created_at",
                            "issued_admissions",
                            "checked_in_admissions",
                          ]
                        : [
                            "reference",
                            "buyer_name",
                            "buyer_email",
                            "order_reference",
                            "category",
                            "admission_ordinal",
                            "status",
                            "checked_in_at",
                            "check_in_method",
                            "checked_in_by",
                          ]
                      ).map((key) => (
                        <td key={key}>
                          {key === "total_minor"
                            ? money(String(row[key]), String(row.currency))
                            : (row[key] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.rows.length && <p>No matching records.</p>}
            <div className="report-metrics">
              <button
                className="text-button"
                disabled={busy || data.page <= 1}
                onClick={() => void load({ ...applied, page: data.page - 1 })}
              >
                Previous page
              </button>
              <button
                className="text-button"
                disabled={
                  busy ||
                  data.page >= 2000 ||
                  BigInt(data.page * data.pageSize) >= BigInt(data.total)
                }
                onClick={() => void load({ ...applied, page: data.page + 1 })}
              >
                Next page
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
