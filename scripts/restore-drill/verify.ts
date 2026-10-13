import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  openCredential,
  type Keyring,
} from "../../src/modules/tickets/credentials";

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
export async function fingerprint(pool: Pool) {
  const { rows: tables } = await pool.query<{
    schemaname: string;
    tablename: string;
  }>(
    "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename",
  );
  const data = [];
  for (const table of tables) {
    const qualified = `${identifier(table.schemaname)}.${identifier(table.tablename)}`;
    const { rows } = await pool.query(
      `SELECT to_jsonb(t)::text AS row FROM ${qualified} t ORDER BY 1`,
    );
    const hash = createHash("sha256");
    for (const row of rows) hash.update(row.row).update("\n");
    data.push({
      table: qualified,
      rows: rows.length,
      hash: hash.digest("hex"),
    });
  }
  // Definitions, not OIDs: restored objects receive new internal identifiers.
  const { rows: protections } = await pool.query(`
    SELECT 'constraint' AS kind, n.nspname AS schema, c.relname AS object,
      con.conname AS name, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','drizzle')
    UNION ALL
    SELECT 'trigger', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public','drizzle')
    UNION ALL
    SELECT 'function', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
    UNION ALL
    SELECT 'index', schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname IN ('public','drizzle')
    ORDER BY 1,2,3,4`);
  return { data, protections };
}

export async function verifyRestoredTickets(
  pool: Pool,
  orderId: string,
  keys: Keyring,
) {
  const { rows } = await pool.query(
    "SELECT * FROM tickets WHERE order_id=$1 ORDER BY admission_ordinal",
    [orderId],
  );
  assert.equal(rows.length, 3);
  const tokens = rows.map((t) =>
    openCredential(
      t.credential_ciphertext,
      t.id,
      t.credential_key_id,
      t.credential_hash,
      keys,
    ),
  );
  assert.equal(new Set(tokens).size, 3);
  for (const t of rows) {
    assert.throws(() =>
      openCredential(
        t.credential_ciphertext,
        t.id,
        t.credential_key_id,
        t.credential_hash,
        { active: keys.active, keys: {} },
      ),
    );
    assert.throws(() =>
      openCredential(
        t.credential_ciphertext,
        t.id,
        t.credential_key_id,
        t.credential_hash,
        { active: keys.active, keys: { [keys.active]: "00".repeat(32) } },
      ),
    );
  }
  // Prove restored enforcement works, not just that its catalog definitions exist.
  await assert.rejects(
    pool.query("UPDATE orders SET total=total+1 WHERE id=$1", [orderId]),
    { code: "23514" },
  );
  await assert.rejects(
    pool.query("UPDATE tickets SET admission_ordinal=0 WHERE id=$1", [
      rows[0].id,
    ]),
    { code: "23514" },
  );
}
