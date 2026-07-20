import { json, sbAuth, openSession, authCookieHeaders } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!b.access_token || !b.refresh_token) return json({ error: "Missing tokens." }, 400);
  const u = await sbAuth(env, "user", undefined, b.access_token);
  if (!u.ok || !u.data || !u.data.id) return json({ error: "Invalid token." }, 401);
  const sid = await openSession(env, u.data.id);
  if (!sid) return json({ error: "Could not open session." }, 500);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: authCookieHeaders(b.access_token, b.refresh_token, sid) });
}
