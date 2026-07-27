import { json, sbAuth, validEmail } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!validEmail(b.email)) return json({ error: "Enter a valid email address." }, 400);
  const site = env.SITE_URL || new URL(request.url).origin;
  /* redirect_to is a URL query parameter on GoTrue's real wire format, same as the fix applied
     to magic.js — see the comment there for why a body-nested options object doesn't work. This
     is an on-demand fallback only (used when a password is actually forgotten), not a routine
     step in every sign-in, unlike the old mandatory-confirmation gate this feature replaces. */
  await sbAuth(env, `recover?redirect_to=${encodeURIComponent(site)}`, { email: b.email });
  /* Always report success, whether or not that address has an account — otherwise this endpoint
     becomes a way to check which emails are registered. */
  return json({ ok: true });
}
