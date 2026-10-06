import { spawnSync } from "node:child_process";

// Reviewed dev-tool-only exception; see docs/security.md. Never applies to prod.
const advisory = "GHSA-vfj7-8cjw-p6xm";
const expires = Date.parse("2026-10-20T00:00:00Z");
function audit(args, allowException = false) {
  const result = spawnSync("pnpm", ["audit", "--json", ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    console.error("Dependency audit could not complete.");
    process.exit(1);
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error("Invalid dependency audit response.");
    process.exit(1);
  }
  if (!report.advisories || !report.metadata?.vulnerabilities || report.error) {
    console.error("Dependency audit report is incomplete.");
    process.exit(1);
  }
  const findings = Object.values(report.advisories);
  const remaining = findings.filter(
    (item) =>
      !(
        allowException &&
        item.github_advisory_id === advisory &&
        item.module_name === "braces" &&
        item.findings?.length &&
        item.findings.every(
          (finding) => finding.dev === true && finding.version === "3.0.3",
        )
      ),
  );
  if (remaining.length || (result.status === 1 && findings.length === 0)) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  console.log(
    `${args.includes("--prod") ? "Production" : "Full"} dependency audit passed${findings.length ? " with the documented dev-only exception" : ""}.`,
  );
}

audit(["--prod"]);
if (Date.now() < expires) {
  console.warn(
    `Temporary dev-only exception: ${advisory}; review by 2026-10-20.`,
  );
  audit([], true);
} else {
  // Expiry restores the complete audit automatically, without an exception.
  audit([]);
}
