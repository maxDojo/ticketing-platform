import { createHash } from "node:crypto";
import type { Pool } from "pg";
export async function consumeLimit(
  pool: Pool,
  identifier: string,
  limit: number,
  seconds: number,
) {
  const key = createHash("sha256").update(identifier).digest("hex");
  const result = await pool.query(
    `INSERT INTO auth_throttle (key,count,resets_at) VALUES ($1,1,now()+$3*interval '1 second')
    ON CONFLICT (key) DO UPDATE SET count=CASE WHEN auth_throttle.resets_at<=now() THEN 1 ELSE auth_throttle.count+1 END,
    resets_at=CASE WHEN auth_throttle.resets_at<=now() THEN now()+$3*interval '1 second' ELSE auth_throttle.resets_at END
    WHERE auth_throttle.resets_at<=now() OR auth_throttle.count<$2 RETURNING key`,
    [key, limit, seconds],
  );
  return result.rowCount === 1;
}
