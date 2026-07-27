import { json, sbAuth, sbAdmin, openSession, authCookieHeaders, validEmail } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!validEmail(b.email)) return json({ error: "Enter a valid email address." }, 400);
  if (typeof b.password !== "string" || b.password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  /* Create the user directly through the Admin API with email_confirm:true set at creation time,
     instead of the public /signup endpoint. Two reasons: (1) it removes Supabase's default
     "click an emailed link before password login works" gate — the "must use a link every time"
     friction this whole feature replaces — without touching the project's dashboard settings;
     (2) verified live that the public /signup endpoint currently fails outright with "Error
     sending confirmation email" (Supabase's own mailer erroring, independent of anything in this
     codebase) — going through Admin API creation never attempts to send that email at all, so
     it sidesteps that failure entirely rather than depending on Supabase's mail delivery working. */
  const created = await sbAdmin(env, "POST", "users", { email: b.email, password: b.password, email_confirm: true });
  if (!created.ok) {
    const msg = created.data && (created.data.msg || created.data.error_description || created.data.error);
    return json({ error: /registered|exists/i.test(msg || "") ? "An account with that email already exists." : (msg || "Sign-up failed.") }, 400);
  }

  const login = await sbAuth(env, "token?grant_type=password", { email: b.email, password: b.password });
  if (!login.ok || !login.data || !login.data.access_token) return json({ ok: true, autoLogin: false });

  const sid = await openSession(env, login.data.user.id);
  if (!sid) return json({ ok: true, autoLogin: false });
  return new Response(JSON.stringify({ ok: true, autoLogin: true }), { status: 200, headers: authCookieHeaders(login.data.access_token, login.data.refresh_token, sid) });
}
