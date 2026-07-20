import { json, sbAuth, openSession, authCookieHeaders, validEmail } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!validEmail(b.email) || typeof b.password !== "string") return json({ error: "Invalid credentials." }, 400);
  const r = await sbAuth(env, "token?grant_type=password", { email: b.email, password: b.password });
  if (!r.ok || !r.data || !r.data.access_token) return json({ error: "Invalid email or password." }, 401);
  const sid = await openSession(env, r.data.user.id);
  if (!sid) return json({ error: "Could not open session." }, 500);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: authCookieHeaders(r.data.access_token, r.data.refresh_token, sid) });
}
