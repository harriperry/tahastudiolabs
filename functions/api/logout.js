import { getCookies, db, clearAuthHeaders } from "../_utils.js";
export async function onRequestPost(context) {
  const { request, env } = context;
  const c = getCookies(request);
  if (c.sf_sid) await db(env, "DELETE", `active_sessions?session_id=eq.${c.sf_sid}`);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: clearAuthHeaders() });
}
