import { json, sbAuth, validEmail } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!validEmail(b.email)) return json({ error: "Enter a valid email address." }, 400);
  if (typeof b.password !== "string" || b.password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  const r = await sbAuth(env, "signup", { email: b.email, password: b.password });
  if (!r.ok) return json({ error: (r.data && (r.data.msg || r.data.error_description)) || "Sign-up failed." }, 400);
  return json({ ok: true });
}
