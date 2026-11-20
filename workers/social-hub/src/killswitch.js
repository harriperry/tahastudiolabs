/* Kill switch and per-client flag. Publishing is off for a client until an admin enables it,
   and either the global pause or the client pause stops every send immediately. Jobs that are
   held back stay scheduled and untouched. */
import { audit } from "./audit.js";
import { nowIso } from "./util.js";

export async function getSwitches(env, clientId) {
  const g = await env.DB.prepare("SELECT paused FROM social_global WHERE id = 1").first();
  const s = await env.DB.prepare("SELECT enabled, paused FROM social_settings WHERE client_id = ?").bind(clientId).first();
  return {
    globalPaused: !!(g && g.paused),
    enabled: !!(s && s.enabled),
    clientPaused: !!(s && s.paused)
  };
}

export async function canPublish(env, clientId) {
  const s = await getSwitches(env, clientId);
  if (s.globalPaused) return { ok: false, reason: "global_pause" };
  if (!s.enabled) return { ok: false, reason: "not_enabled" };
  if (s.clientPaused) return { ok: false, reason: "client_pause" };
  return { ok: true };
}

export async function setGlobalPause(env, paused, actor) {
  await env.DB.prepare("UPDATE social_global SET paused = ?, updated_at = ? WHERE id = 1").bind(paused ? 1 : 0, nowIso()).run();
  await audit(env, { actor, action: paused ? "global_pause_on" : "global_pause_off" });
}

export async function setClientFlags(env, clientId, { enabled, paused }, actor) {
  const cur = await env.DB.prepare("SELECT enabled, paused FROM social_settings WHERE client_id = ?").bind(clientId).first();
  const e = enabled === undefined ? (cur ? cur.enabled : 0) : enabled ? 1 : 0;
  const p = paused === undefined ? (cur ? cur.paused : 0) : paused ? 1 : 0;
  await env.DB.prepare(
    "INSERT INTO social_settings (client_id, enabled, paused, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET enabled = excluded.enabled, paused = excluded.paused, updated_at = excluded.updated_at"
  ).bind(clientId, e, p, nowIso()).run();
  await audit(env, { clientId, actor, action: "client_flags", detail: { enabled: !!e, paused: !!p } });
}
