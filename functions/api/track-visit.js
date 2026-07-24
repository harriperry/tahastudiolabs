import { db, json } from "../_utils.js";

// Records a privacy-preserving visit: only a salted SHA-256 hash of the
// visitor's IP is ever stored (never the raw IP), aggregated into
// public.site_visits via the increment_visit() Postgres function.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const salt = env.VISIT_SALT || env.SUPABASE_SERVICE_ROLE_KEY || "static-fallback-salt";
    const enc = new TextEncoder().encode(salt + "|" + ip);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    const bytes = Array.from(new Uint8Array(digest));
    const ip_hash = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

    await db(env, "POST", "rpc/increment_visit", { p_ip_hash: ip_hash });

    return json({ ok: true });
  } catch (err) {
    // Never break the page load for visitors if tracking fails.
    return json({ ok: false });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
