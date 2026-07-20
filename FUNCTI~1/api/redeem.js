import { json, requireUser, db } from "../_utils.js";
/* One-time license redemption (Brief §3): validate with Polar, then bind permanently
   to this account. After redemption, access is gated by login — not the key string. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireUser(context);
  if (auth.error) return auth.error;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  const key = (b.license_key || "").trim();
  if (!key || key.length > 128) return json({ error: "Enter a license key." }, 400);

  const existing = await db(env, "GET", `license_redemptions?license_key=eq.${encodeURIComponent(key)}&select=user_id`);
  if (existing.ok && existing.data && existing.data.length > 0) {
    if (existing.data[0].user_id === auth.user.id) return json({ ok: true, note: "Already redeemed on this account." });
    return json({ error: "This license key has already been redeemed by another account." }, 409);
  }

  // Validate with Polar. NOTE: confirm exact endpoint/payload against current Polar docs at build time.
  const pv = await fetch("https://api.polar.sh/v1/customer-portal/license-keys/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, organization_id: env.POLAR_ORGANIZATION_ID })
  });
  if (!pv.ok) return json({ error: "License key is not valid." }, 400);

  const ins = await db(env, "POST", "license_redemptions", { license_key: key, user_id: auth.user.id });
  if (!ins.ok) return json({ error: "Redemption failed — try again." }, 500);
  await db(env, "POST", "subscriptions", { user_id: auth.user.id, status: "active", tier: "pro", updated_at: new Date().toISOString() });
  return json({ ok: true });
}
