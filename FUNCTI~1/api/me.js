import { json, requireUser, getSubscription } from "../_utils.js";
export async function onRequestGet(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;
  const sub = await getSubscription(context.env, auth.user.id);
  const body = { email: auth.user.email, status: sub.status, tier: sub.tier };
  if (auth.refreshedHeaders) return new Response(JSON.stringify(body), { status: 200, headers: auth.refreshedHeaders });
  return json(body);
}
