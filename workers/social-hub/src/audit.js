/* Append-only audit log. Detail is JSON with secret-looking fields redacted, so a token or key
   can never land here even by mistake. */
import { nowIso } from "./util.js";

const SECRET = /token|secret|key|password|authorization|cookie|code|verifier/i;

export function redact(value, depth = 0) {
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

export async function audit(env, { clientId = null, actor, action, detail = null }) {
  const text = detail ? JSON.stringify(redact(detail)).slice(0, 2000) : null;
  await env.DB.prepare("INSERT INTO social_audit (client_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)")
    .bind(clientId, actor, action, text, nowIso())
    .run();
}
