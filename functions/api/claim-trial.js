import { json, requireUser, db, getSubscription } from "../_utils.js";
export async function onRequestPost(context) {
  const auth = await requireUser(context);
  if (auth.error) return auth.error;
  const { env } = context;

  const sub = await getSubscription(env, auth.user.id);
  if (!sub.trialAvailable) return json({ error: "Trial already used, or you already have a plan on this account." }, 400);

  /* 7 days of full Pro access, ending at a UTC-midnight boundary rather than "exactly 168 hours
     from the click" — claiming on any day D grants the rest of D plus 6 more full days, then
     lapses at 00:00 UTC on day D+7. That boundary is the ONLY thing that determines expiry:
     getSubscription() in _utils.js checks it live on every read, so there is no scheduled job
     that has to fire at midnight for the downgrade to happen. */
  const now = new Date();
  const trialEndsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7, 0, 0, 0)).toISOString();

  const ins = await db(env, "POST", "subscriptions", {
    user_id: auth.user.id,
    status: "active",
    tier: "pro",
    trial_claimed_at: now.toISOString(),
    trial_ends_at: trialEndsAt,
    updated_at: now.toISOString()
  });
  if (!ins.ok) return json({ error: "Could not start trial — try again." }, 500);
  return json({ ok: true, trialEndsAt });
}
