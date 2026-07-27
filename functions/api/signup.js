import { json, sbAuth, sbAdmin, openSession, authCookieHeaders, validEmail } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (!validEmail(b.email)) return json({ error: "Enter a valid email address." }, 400);
  if (typeof b.password !== "string" || b.password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  const r = await sbAuth(env, "signup", { email: b.email, password: b.password });
  if (!r.ok) return json({ error: (r.data && (r.data.msg || r.data.error_description)) || "Sign-up failed." }, 400);

  /* Supabase's default project setting requires clicking an emailed confirmation link before
     password login will succeed — that's the "must use a link every time" friction this removes.
     If the project already auto-confirms (no email step configured), signup() above returns a
     full session directly and we just use it. Otherwise the new user comes back unconfirmed with
     no session, so we confirm it ourselves via the Admin API (service-role, bypasses the project's
     dashboard setting entirely) and immediately grant a password-login session — the user ends up
     signed in with the password they just chose, without ever touching their inbox. */
  let at, rt, uid;
  if (r.data && r.data.access_token && r.data.user) {
    at = r.data.access_token; rt = r.data.refresh_token; uid = r.data.user.id;
  } else {
    const newUserId = r.data && r.data.id;
    if (newUserId) await sbAdmin(env, "PUT", `users/${newUserId}`, { email_confirm: true });
    const login = await sbAuth(env, "token?grant_type=password", { email: b.email, password: b.password });
    if (login.ok && login.data && login.data.access_token) {
      at = login.data.access_token; rt = login.data.refresh_token; uid = login.data.user.id;
    }
  }
  if (!at) return json({ ok: true, autoLogin: false });

  const sid = await openSession(env, uid);
  if (!sid) return json({ ok: true, autoLogin: false });
  return new Response(JSON.stringify({ ok: true, autoLogin: true }), { status: 200, headers: authCookieHeaders(at, rt, sid) });
}
