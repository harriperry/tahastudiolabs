/* OAuth connect flow, safe by construction:
   - state is 32 random bytes, stored only as a SHA-256 hash, single use, valid 10 minutes;
   - state is bound to the client and to the signed-in session that started it, so a link
     started by one person cannot be completed by another;
   - PKCE: the verifier is stored encrypted and only ever used server side;
   - the redirect URI must match exactly what was stored at start;
   - tokens are encrypted before they touch the database and are never returned or logged. */
import { audit } from "./audit.js";
import { decryptToken, encryptToken } from "./crypto.js";
import { getConnector } from "./connectors/index.js";
import { newId, nowIso, nowMs, randomToken, sha256b64url, sha256hex } from "./util.js";

const STATE_TTL_MS = 10 * 60 * 1000;

export async function startOAuth(env, { clientId, platform, sessionHash, redirectUri }) {
  const connector = getConnector(env, platform);
  if (!connector) return { error: "platform_unavailable" };
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = await sha256b64url(verifier);
  const t = nowMs();
  await env.DB.prepare(
    "INSERT INTO social_oauth_states (state_hash, client_id, platform, session_hash, verifier_enc, redirect_uri, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(await sha256hex(state), clientId, platform, sessionHash, await encryptToken(env, verifier), redirectUri, t, t + STATE_TTL_MS).run();
  await audit(env, { clientId, actor: "client", action: "oauth_start", detail: { platform } });
  return { url: connector.authUrl({ state, challenge, redirectUri, env }) };
}

/* Marks the state used first (atomic), then validates everything else. A replayed, expired or
   foreign state can never reach the token exchange. */
export async function completeOAuth(env, { state, code, platform, sessionHash, redirectUri }) {
  if (!state || !code) return { error: "bad_request" };
  const hash = await sha256hex(state);
  const t = nowMs();
  const claim = await env.DB.prepare(
    "UPDATE social_oauth_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL AND expires_at > ?"
  ).bind(t, hash, t).run();
  if (!claim.meta || claim.meta.changes !== 1) return { error: "invalid_state" };
  const row = await env.DB.prepare(
    "SELECT client_id, platform, session_hash, verifier_enc, redirect_uri FROM social_oauth_states WHERE state_hash = ?"
  ).bind(hash).first();
  if (!row || row.platform !== platform || row.session_hash !== sessionHash || row.redirect_uri !== redirectUri) {
    await audit(env, { clientId: row ? row.client_id : null, actor: "client", action: "oauth_rejected", detail: { platform } });
    return { error: "invalid_state" };
  }
  const connector = getConnector(env, platform);
  if (!connector) return { error: "platform_unavailable" };
  let result;
  try {
    const verifier = await decryptToken(env, row.verifier_enc);
    result = await connector.exchangeCode({ code, verifier, redirectUri, env });
  } catch (e) {
    await audit(env, { clientId: row.client_id, actor: "client", action: "oauth_exchange_failed", detail: { platform, reason: String((e && e.message) || "unknown").slice(0, 200) } });
    return { error: "exchange_failed" };
  }
  /* A connector returns either one account (mock) or a list (Meta: each Page plus its linked
     Instagram account). Every account is stored with its own encrypted token. */
  const list = Array.isArray(result.accounts)
    ? result.accounts
    : [{ platform, externalRef: result.externalRef, displayName: result.displayName, accessToken: result.accessToken, refreshToken: result.refreshToken, expiresAt: result.expiresAt }];
  const now = nowIso();
  const ids = [];
  for (const a of list) {
    const tokenEnc = await encryptToken(env, a.accessToken);
    const refreshEnc = a.refreshToken ? await encryptToken(env, a.refreshToken) : null;
    await env.DB.prepare(
      `INSERT INTO social_accounts (id, client_id, platform, external_ref, display_name, token_enc, refresh_enc, token_expires_at, status, created_at, updated_at, provider_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
       ON CONFLICT(client_id, platform, external_ref) DO UPDATE SET
         display_name = excluded.display_name, token_enc = excluded.token_enc, refresh_enc = excluded.refresh_enc,
         token_expires_at = excluded.token_expires_at, status = 'active', updated_at = excluded.updated_at,
         provider_user_id = excluded.provider_user_id`
    ).bind(newId("sa"), row.client_id, a.platform, a.externalRef, a.displayName, tokenEnc, refreshEnc, a.expiresAt || null, now, now, result.providerUserId || null).run();
    const acc = await env.DB.prepare(
      "SELECT id FROM social_accounts WHERE client_id = ? AND platform = ? AND external_ref = ?"
    ).bind(row.client_id, a.platform, a.externalRef).first();
    ids.push(acc.id);
  }
  await audit(env, { clientId: row.client_id, actor: "client", action: "account_connected", detail: { platform, accountIds: ids } });
  return { accountId: ids[0], accountIds: ids, count: ids.length, clientId: row.client_id, displayName: list[0].displayName };
}

export async function revokeAccount(env, { clientId, accountId, actor }) {
  const r = await env.DB.prepare(
    "UPDATE social_accounts SET status = 'revoked', token_enc = 'revoked', refresh_enc = NULL, updated_at = ? WHERE id = ? AND client_id = ?"
  ).bind(nowIso(), accountId, clientId).run();
  await audit(env, { clientId, actor, action: "account_revoked", detail: { accountId } });
  return r.meta && r.meta.changes === 1;
}
