import { json, sbAuth, requireUser } from "../_utils.js";
export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;
  const { request, env } = context;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  if (typeof b.password !== "string" || b.password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  /* Self-service password change for a signed-in user: PUT /auth/v1/user with the user's own
     access token (not the service role key) is GoTrue's standard "update the logged-in user"
     endpoint. Used both from the account panel directly, and right after a password-recovery
     link lands the user back signed in, so they can set a permanent password in one step. */
  const r = await sbAuth(env, "user", { password: b.password }, auth.accessToken, "PUT");
  if (!r.ok) return json({ error: (r.data && (r.data.msg || r.data.error_description)) || "Could not update password." }, 400);

  const body = { ok: true };
  if (auth.refreshedHeaders) return new Response(JSON.stringify(body), { status: 200, headers: auth.refreshedHeaders });
  return json(body);
}
