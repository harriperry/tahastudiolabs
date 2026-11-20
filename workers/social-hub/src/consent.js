/* Social consent is separate from the Vault consent version, so adding social publishing never
   forces every existing client back through the Vault consent screen. */
import { audit } from "./audit.js";
import { nowIso } from "./util.js";

export function currentVersion(env) {
  return env.SOCIAL_CONSENT_VERSION || "s-1";
}

export async function hasConsent(env, clientId) {
  const r = await env.DB.prepare(
    "SELECT 1 AS ok FROM social_consents WHERE client_id = ? AND version = ? LIMIT 1"
  ).bind(clientId, currentVersion(env)).first();
  return !!r;
}

export async function recordConsent(env, clientId, email) {
  await env.DB.prepare(
    "INSERT INTO social_consents (client_id, version, accepted_at, accepted_by) VALUES (?, ?, ?, ?)"
  ).bind(clientId, currentVersion(env), nowIso(), email).run();
  await audit(env, { clientId, actor: email, action: "consent_accepted", detail: { version: currentVersion(env) } });
}
