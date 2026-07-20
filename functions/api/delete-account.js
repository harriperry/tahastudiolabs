import { json, requireUser, sbAuth, sbAdmin, db, clearAuthHeaders } from "../_utils.js";
/* GDPR deletion (Brief §8, Policy §8): removes email, credential, subscription and
   redemption records immediately (FK cascade + auth admin delete). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireUser(context);
  if (auth.error) return auth.error;
  let b; try { b = await request.json(); } catch (e) { return json({ error: "Bad request." }, 400); }
  // Re-authentication for sensitive action (Brief §2)
  const re = await sbAuth(env, "token?grant_type=password", { email: auth.user.email, password: b.password || "" });
  if (!re.ok) return json({ error: "Password confirmation failed." }, 403);
  await db(env, "DELETE", `active_sessions?user_id=eq.${auth.user.id}`);
  await db(env, "DELETE", `license_redemptions?user_id=eq.${auth.user.id}`);
  await db(env, "DELETE", `subscriptions?user_id=eq.${auth.user.id}`);
  const del = await sbAdmin(env, "DELETE", `users/${auth.user.id}`);
  if (!del.ok) return json({ error: "Deletion failed — contact support." }, 500);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: clearAuthHeaders() });
}
