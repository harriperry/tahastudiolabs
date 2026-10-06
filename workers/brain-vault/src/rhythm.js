/* V2 Part C: the monthly rhythm. Every active client gets a campaign each month without Harry
   having to remember it.

   GET  /admin/rhythm                      every client in the rhythm, its plan and its next due
                                           campaign; "due" holds those due within 7 days or late
   GET  /admin/plan/:clientId              the client's plan (defaults until Harry saves one)
   PUT  /admin/plan/:clientId  {plan}      save: perMonth 1 to 4, readyDay 1 to 28, channels,
                                           goal, active, startMonth
   GET  /admin/plan/:clientId/last-results what the last three campaigns brought in, as data and
                                           as plain text for the Campaign Generator's
                                           {{LAST_RESULTS}} (Part D adds the client's own numbers)

   Daily job: from the 20th of each month (Stockholm time), once per month, Harry gets one email
   listing who is due. Company names and dates only, no client content.

   The due rule: a campaign for month M is due on readyDay of the month before M. The next due
   one is the first month, from this month (or the plan's start month, if later) to next month,
   that has fewer campaigns than perMonth. A client who has left, has no Business Brain yet, or
   whose plan is paused is skipped. */
import { composeRhythmReminder, sendMail } from "./mail.js";
import { json, nowIso, readJson } from "./util.js";
import { readBaselines, readCosts, computeRoi } from "./roi.js";
import { DUE_WINDOW_DAYS, REMINDER_DAY, PLAN_CHANNELS, PLAN_GOALS, defaultPlan, nextDue, resultsText, stockholmDate, validatePlan } from "./rhythm-core.js";

export { PLAN_CHANNELS, PLAN_GOALS };

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." }
};

/* ---------- plan storage ---------- */

function planOut(row, client, todayMonth) {
  if (!row) return defaultPlan(client.created_at, todayMonth);
  let channels = [];
  try { channels = JSON.parse(row.channels); } catch (e) {}
  return { perMonth: row.per_month, readyDay: row.ready_day, channels, goal: row.goal, active: !!row.active, startMonth: row.start_month, saved: true, updatedAt: row.updated_at };
}

async function client(env, clientId) {
  return env.DB.prepare("SELECT id, name, created_at, left_at FROM clients WHERE id = ?").bind(clientId).first();
}

/* Development only: the tests move the clock with ?today=YYYY-MM-DD. */
function todayFrom(url, cfg, ms) {
  const t = url && url.searchParams.get("today");
  if (cfg.environment === "development" && t && /^\d{4}-\d{2}-\d{2}$/.test(t)) return { iso: t, month: t.slice(0, 7), d: +t.slice(8, 10) };
  return stockholmDate(ms == null ? Date.now() : ms);
}

export async function getPlan(env, cfg, clientId, url) {
  const c = await client(env, clientId);
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const today = todayFrom(url, cfg);
  const row = await env.DB.prepare("SELECT * FROM plans WHERE client_id = ?").bind(clientId).first();
  return json({ plan: planOut(row, c, today.month), channels: PLAN_CHANNELS, goals: PLAN_GOALS });
}

export async function putPlan(request, env, cfg, clientId) {
  const c = await client(env, clientId);
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const body = await readJson(request);
  const v = validatePlan(body && body.plan);
  if (v.errors) return json({ error: "invalid", message: M.badRequest, errors: v.errors }, 400);
  const p = v.plan;
  const t = nowIso();
  await env.DB.prepare(
    "INSERT INTO plans (client_id, per_month, ready_day, channels, goal, active, start_month, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(client_id) DO UPDATE SET per_month = excluded.per_month, ready_day = excluded.ready_day, channels = excluded.channels, goal = excluded.goal, active = excluded.active, start_month = excluded.start_month, updated_at = excluded.updated_at"
  ).bind(clientId, p.perMonth, p.readyDay, JSON.stringify(p.channels), p.goal, p.active ? 1 : 0, p.startMonth, t, t).run();
  const row = await env.DB.prepare("SELECT * FROM plans WHERE client_id = ?").bind(clientId).first();
  return json({ ok: true, plan: planOut(row, c, todayFrom(null, cfg).month) });
}

/* ---------- the overview, shared by the panel and the reminder ---------- */

async function overview(env, today) {
  const clients = (await env.DB.prepare(
    "SELECT c.id, c.name, c.created_at, c.left_at, (SELECT MAX(version) FROM brains b WHERE b.client_id = c.id) AS brain FROM clients c ORDER BY c.name COLLATE NOCASE"
  ).all()).results || [];
  const plans = (await env.DB.prepare("SELECT * FROM plans").all()).results || [];
  const byClient = Object.fromEntries(plans.map((p) => [p.client_id, p]));
  const counts = {};
  ((await env.DB.prepare("SELECT client_id, month, COUNT(*) AS n FROM campaigns GROUP BY client_id, month").all()).results || []).forEach((r) => {
    (counts[r.client_id] = counts[r.client_id] || {})[r.month] = r.n;
  });
  const items = clients.map((c) => {
    const plan = planOut(byClient[c.id], c, today.month);
    let skip = null;
    if (c.left_at) skip = "left";
    else if (!c.brain) skip = "no_brain";
    else if (!plan.active) skip = "paused";
    const next = skip ? null : nextDue(plan, counts[c.id] || {}, today.iso);
    return { clientId: c.id, name: c.name, plan, skip, next };
  });
  const due = items
    .filter((i) => i.next && i.next.daysLeft <= DUE_WINDOW_DAYS)
    .sort((a, b) => a.next.daysLeft - b.next.daysLeft)
    .map((i) => ({ clientId: i.clientId, name: i.name, next: i.next, goal: i.plan.goal, channels: i.plan.channels }));
  return { today: today.iso, windowDays: DUE_WINDOW_DAYS, items, due };
}

export async function getRhythm(env, cfg, url) {
  return json(await overview(env, todayFrom(url, cfg)));
}

/* Daily job. From the 20th, once a month, if anyone is due. */
export async function rhythmReminder(env, cfg, ms) {
  let today = stockholmDate(ms);
  /* Development only: the tests set the date in job_runs ("dev-clock"); never read in production. */
  if (cfg.environment === "development") {
    const clock = await env.DB.prepare("SELECT period FROM job_runs WHERE name = 'dev-clock'").first();
    if (clock && /^\d{4}-\d{2}-\d{2}$/.test(clock.period)) today = { iso: clock.period, month: clock.period.slice(0, 7), d: +clock.period.slice(8, 10) };
  }
  if (today.d < REMINDER_DAY) return { sent: false, reason: "before_20th" };
  const run = await env.DB.prepare("SELECT period FROM job_runs WHERE name = 'rhythm-reminder'").first();
  if (run && run.period === today.month) return { sent: false, reason: "already_sent" };
  const o = await overview(env, today);
  await env.DB.prepare("INSERT INTO job_runs (name, period, at) VALUES ('rhythm-reminder', ?, ?) ON CONFLICT(name) DO UPDATE SET period = excluded.period, at = excluded.at")
    .bind(today.month, nowIso()).run();
  if (!o.due.length) return { sent: false, reason: "nobody_due" };
  const mail = composeRhythmReminder(cfg, { items: o.due, link: cfg.growthPanelUrl });
  await sendMail(cfg, env, { to: cfg.tahaEmail, ...mail });
  return { sent: true, count: o.due.length };
}

/* ---------- last results for the Campaign Generator ---------- */

export async function lastResults(env, cfg, clientId, url) {
  const c = await client(env, clientId);
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const before = url && url.searchParams.get("before");
  const rows = ((await env.DB.prepare("SELECT campaign_id, month, data FROM campaigns WHERE client_id = ? ORDER BY month DESC, created_at DESC").bind(clientId).all()).results || [])
    .filter((r) => !before || r.month < before)
    .slice(0, 3);
  const out = [];
  for (const r of rows) {
    let d = {};
    try { d = JSON.parse(r.data); } catch (e) {}
    const page = await env.DB.prepare("SELECT id FROM pages WHERE client_id = ? AND campaign_id = ?").bind(clientId, r.campaign_id).first();
    const stats = page ? ((await env.DB.prepare("SELECT day, channel, type, n FROM daily_stats WHERE page_id = ?").bind(page.id).all()).results || []) : [];
    const links = page ? ((await env.DB.prepare("SELECT channel, offer_code FROM links WHERE page_id = ?").bind(page.id).all()).results || []).map((l) => ({ channel: l.channel, offerCode: l.offer_code })) : [];
    const leads = (await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE client_id = ? AND campaign_id = ?").bind(clientId, r.campaign_id).first()).n;
    const baselines = await readBaselines(env, clientId, r.campaign_id);
    const costs = await readCosts(env, clientId, r.campaign_id);
    const roi = computeRoi({ stats, leads, baselines, costs, links });
    const offer = d.offer && d.offer.terms ? String(d.offer.terms).slice(0, 160) : "";
    out.push({ campaignId: r.campaign_id, name: d.name || r.campaign_id, month: r.month, goal: d.goal || "", offer, hasPage: !!page, roi });
  }
  return json({ results: out, text: resultsText(out) });
}
