import { db, json } from "../_utils.js";

// Admin-only endpoint: returns aggregate, anonymized visit stats.
// Requires a secret key (ADMIN_STATS_KEY) passed as ?key= or X-Admin-Key
// header. Never exposes individual IPs or hashes, only the two totals.
export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const providedKey = url.searchParams.get("key") || request.headers.get("X-Admin-Key") || "";

  if (!env.ADMIN_STATS_KEY || providedKey !== env.ADMIN_STATS_KEY) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const rows = await db(env, "POST", "rpc/visit_stats", {});
    const stats = Array.isArray(rows) && rows[0] ? rows[0] : { unique_visitors: 0, total_visits: 0 };
    return json(stats);
  } catch (err) {
    return json({ error: "Failed to load stats" }, 500);
  }
}
