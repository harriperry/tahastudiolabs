import { json, sbAuth, validEmail } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!validEmail(b.email)) return json({ error: "Enter a valid email address." }, 400);
  const site = env.SITE_URL || new URL(request.url).origin;
  /* GoTrue's real wire format takes the post-click destination as a "redirect_to" URL query
     parameter on the request itself, not as a body field — a body-nested "options.email_redirect_to"
     (the supabase-js SDK's own internal shape) is not read by the raw REST API and was silently
     ignored here, so every magic-link email fell back to Supabase's dashboard-configured default
     Site URL instead of this deployment. Confirmed against gotrue-js's own _request() call sites. */
  const r = await sbAuth(env, `otp?redirect_to=${encodeURIComponent(site)}`, { email: b.email, create_user: true });
  if (!r.ok) return json({ error: "Could not send sign-in link." }, 400);
  return json({ ok: true });
}
