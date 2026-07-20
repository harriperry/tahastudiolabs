import { json, sbAuth, validEmail } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!validEmail(b.email)) return json({ error: "Enter a valid email address." }, 400);
  const site = env.SITE_URL || new URL(request.url).origin;
  const r = await sbAuth(env, "otp", { email: b.email, create_user: true, options: { email_redirect_to: site } });
  if (!r.ok) return json({ error: "Could not send sign-in link." }, 400);
  return json({ ok: true });
}
