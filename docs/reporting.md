# Organizer reporting and CSV exports

Open an event in `/admin/events`, then choose **Organizer reports and exports**.
Only the active owning organizer with a live MFA-verified session can view or export
reports. A gate staff assignment grants no reporting rights. Reports use private,
no-store POST requests so buyer search terms do not enter URLs or browser history.
No new database migration is required for this checkpoint.

## Meaning of the totals

All totals cover the whole event, independently of list filters. Monetary aggregates
remain integer minor-unit strings and are grouped by currency; the interface formats
them without floating-point conversion. Each response uses a consistent PostgreSQL
snapshot across the list, counts and summary.

- Gross fulfilled sales sum the immutable order totals associated with fulfillment,
  once per order. Pending orders and duplicate successful payments do not add sales.
- Verified collections include every verified successful payment, including duplicate
  charges or funds received without a fulfilled order. They are not settled funds.
- Recorded processing fees sum available fees on those verified payments. A separate
  count identifies missing fee values instead of assuming the fees are known to be zero.
- These are gross historical figures. Refund execution/accounting, net revenue, profit
  and provider settlement reconciliation remain separate work.
- Attendance counts issued admissions, historical check-ins, valid unused admissions
  and invalidated tickets. A subsequently invalidated ticket can still have a historical
  check-in; those figures are not mutually exclusive buckets.
- Inventory counts purchasable units/packages. Historical admissions retain the
  entitlement captured at purchase, even if a category's package size changes.

## Finding records

Choose orders or admissions, an optional status, and a buyer name, exact buyer email,
order reference or (for admissions) ticket reference. Names use literal substring
matching; wildcard characters do not broaden searches. Admission names identify the
buyer, who is not necessarily the person attending. Contact details are visible only
to the owning organizer. The report never returns QR credentials, recovery links,
provider secrets or raw payment data.

Results use 50-row pages, ordered by creation time and ID. Pagination is bounded to
2,000 pages; narrow the filters for larger sets. Each request is a fresh snapshot, so
new arrivals/orders between page requests may move rows. There is no long-lived browsing
snapshot or automatic refresh. Reapply filters to refresh the event totals.

## Export behavior and privacy

The export uses the currently applied filters and includes all matches, not only the
visible page. It refuses more than 10,000 rows instead of truncating. Narrow the search
or status filter for large exports. The API allows five export requests per account per
minute and 60 view requests per minute. Each successful export preparation records the
actor, event and report type in the audit log before returning the file; it cannot prove
that a browser subsequently saved the download. Audit failure blocks the export.

CSV uses UTF-8 with a BOM, quoted/escaped cells and UTC timestamp columns. Amounts in
the order export are integer minor units, with a separate currency column. Potential
spreadsheet formula prefixes (including whitespace/control prefixes and full-width
variants) receive a visible `Text: ` prefix in the exported cell. The stored record is
not changed. This intentionally trades exact reproduction of dangerous cell contents
for spreadsheet-safe text; programmatic consumers should account for the prefix.

Export files contain buyer names and email addresses. Store them privately, restrict
access, avoid public attachments/shared drives and delete them under the eventual
retention policy. Escaping does not protect files after someone edits or transforms
them; downstream consumers must preserve text handling. See the
[OWASP CSV injection guidance](https://owasp.org/www-community/attacks/CSV_Injection).

## Verification and remaining work

Tests cover duplicate-payment versus fulfilled-sales totals, exact fee sums, attendance,
search, pagination, full filtered exports, the export cap, formula neutralization,
MFA/ownership/staff isolation and audit failure. Browser checks exercise authenticated
report pages and downloaded CSVs on desktop and mobile. Settlement
reporting, export retention controls and production-scale load testing remain launch work.

Confirmed refunds are now shown separately from historical gross sales, with refunded fulfilled sales and unresolved refund approvals distinguished. See [refund operations](refunds.md). Settlement reconciliation remains separate work.
