import { json, db, sbAdmin } from "../_utils.js";
/* Polar webhook receiver. Verifies Standard-Webhooks HMAC signature, then updates
   subscription status. Supports instant revocation (Brief §3) on refund/cancellation
   without a deploy. Only email + status flow through here — nothing else is stored. */

async function verifySignature(env, request, rawBody) {
  const id = request.headers.get("webhook-id"), ts = request.headers.get("webhook-timestamp"),
        sig = request.headers.get("webhook-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - parseInt(ts, 10)) > 300) return false; // 5-min replay window
  const secret = (env.POLAR_WEBHOOK_SECRET || "").replace(/^whsec_/, "");
  const keyBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return sig.split(" ").some(part => { const p = part.split(","); return p[p.length - 1] === expected; });
}

async function setStatusByEmail(env, email, status) {
  const users = await sbAdmin(env, "GET", `users?email=${encodeURIComponent(email)}`);
  const list = (users.data && (users.data.users || users.data)) || [];
  const u = Array.isArray(list) ? list.find(x => x.email === email) : null;
  if (!u) return; // no account yet — license redemption will bind entitlement at first login
  await db(env, "POST", "subscriptions", { user_id: u.id, status, tier: "pro", updated_at: new Date().toISOString() });
  if (status === "inactive") await db(env, "DELETE", `active_sessions?user_id=eq.${u.id}`);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();
  if (!(await verifySignature(env, request, rawBody))) return json({ error: "Invalid signature." }, 401);
  let evt; try { evt = JSON.parse(rawBody); } catch (e) { return json({ error: "Bad payload." }, 400); }

  const type = evt.type || "";
  const email = evt.data && (evt.data.customer && evt.data.customer.email || evt.data.user && evt.data.user.email || evt.data.email);
  if (!email) return json({ ok: true, note: "No customer email in event." });

  if (/subscription\.(active|created|updated)|order\.(paid|created)/.test(type)) {
    const revoked = evt.data && (evt.data.status === "canceled" || evt.data.status === "revoked" || evt.data.status === "refunded");
    await setStatusByEmail(env, email, revoked ? "inactive" : "active");
  } else if (/subscription\.(canceled|revoked)|order\.refunded|refund\.created|dispute/.test(type)) {
    await setStatusByEmail(env, email, "inactive");
  }
  return json({ ok: true });
}
