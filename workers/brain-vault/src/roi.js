/* V2 phase G2b: before and after numbers, costs, the Performance tab, the client's Campaign
   report and Your enquiries (spec 9.4, 9.5).

   Admin:
   GET        /admin/stats/:clientId/:campaignId     Performance tab: counts per channel and day,
                                                     before and after, costs, and the ROI metrics
   GET, PUT   /admin/baseline/:clientId/:campaignId  {before:{metric:value}, after:{metric:value}}
   GET, PUT   /admin/costs/:clientId/:campaignId     {currency (default: the client's market), fee, adSpend:{channel:amount},
                                                     avgOrderValue, baselinePeriod}
   GET        /admin/leads/:clientId/:campaignId     the campaign's enquiries
   Client (own id only):
   GET        /portal/pages                          the client's campaign pages
   GET        /portal/report/:campaignId             the plain-language Campaign report
   GET        /portal/leads                          Your enquiries
   GET        /portal/leads.csv                      the same as CSV
   PATCH      /portal/leads/:leadId {state}          mark as contacted (or new again)
   DELETE     /portal/leads/:leadId                  delete one */
import { daysAfterEnd, linkOut, pageOut } from "./pages.js";
import { json, nowIso, readJson } from "./util.js";
import { currencyOf, validCurrency } from "../../../assets/growth-markets.js";

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." }
};
const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
const METRIC = /^[a-z][a-z0-9_]{1,40}(-[A-Z0-9-]{1,30})?$/;
const num = (v) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
const round = (v, d = 2) => (v == null || !isFinite(v) ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d));

async function campaignRow(env, clientId, campaignId) {
  return env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
}

export async function readBaselines(env, clientId, campaignId) {
  const rows = await all(env, "SELECT metric, period, value FROM baselines WHERE client_id = ? AND campaign_id = ?", clientId, campaignId);
  const out = { before: {}, after: {} };
  rows.forEach((r) => { out[r.period][r.metric] = r.value; });
  return out;
}

/* The currency of the client's market (Markets step 1): new costs start in it. */
async function marketCurrency(env, clientId) {
  const c = await env.DB.prepare("SELECT market FROM clients WHERE id = ?").bind(clientId).first();
  return currencyOf(c && c.market);
}

export async function readCosts(env, clientId, campaignId) {
  const r = await env.DB.prepare("SELECT * FROM costs WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  if (!r) return { currency: await marketCurrency(env, clientId), fee: 0, adSpend: {}, avgOrderValue: null, baselinePeriod: "", updatedAt: null };
  let adSpend = {};
  try { adSpend = JSON.parse(r.ad_spend || "{}"); } catch (e) {}
  return { currency: r.currency, fee: r.fee, adSpend, avgOrderValue: r.avg_order_value, baselinePeriod: r.baseline_period || "", updatedAt: r.updated_at };
}

export async function getBaseline(env, clientId, campaignId) {
  if (!(await campaignRow(env, clientId, campaignId))) return json({ error: "not_found", message: M.notFound }, 404);
  return json(await readBaselines(env, clientId, campaignId));
}

export async function putBaseline(request, env, clientId, campaignId) {
  if (!(await campaignRow(env, clientId, campaignId))) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 16 * 1024);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  const stmts = [];
  const t = nowIso();
  for (const period of ["before", "after"]) {
    const set = b[period];
    if (set == null) continue;
    if (typeof set !== "object" || Array.isArray(set)) return json({ error: "bad_request", message: M.badRequest }, 400);
    const keys = Object.keys(set);
    if (keys.length > 60) return json({ error: "bad_request", message: M.badRequest }, 400);
    for (const k of keys) {
      if (!METRIC.test(k)) return json({ error: "bad_request", message: M.badRequest, metric: k }, 400);
      const v = num(set[k]);
      if (set[k] === null || set[k] === "") stmts.push(env.DB.prepare("DELETE FROM baselines WHERE client_id = ? AND campaign_id = ? AND metric = ? AND period = ?").bind(clientId, campaignId, k, period));
      else if (v === null || v < 0 || v > 1e12) return json({ error: "bad_request", message: M.badRequest, metric: k }, 400);
      else stmts.push(env.DB.prepare("INSERT INTO baselines (client_id, campaign_id, metric, period, value, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(client_id, campaign_id, metric, period) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(clientId, campaignId, k, period, v, t));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json(await readBaselines(env, clientId, campaignId));
}

export async function getCosts(env, clientId, campaignId) {
  if (!(await campaignRow(env, clientId, campaignId))) return json({ error: "not_found", message: M.notFound }, 404);
  return json(await readCosts(env, clientId, campaignId));
}

export async function putCosts(request, env, clientId, campaignId) {
  if (!(await campaignRow(env, clientId, campaignId))) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 8 * 1024);
  if (!b) return json({ error: "bad_request", message: M.badRequest }, 400);
  const fee = num(b.fee) || 0;
  const aov = b.avgOrderValue == null || b.avgOrderValue === "" ? null : num(b.avgOrderValue);
  const ad = {};
  if (b.adSpend && typeof b.adSpend === "object") {
    for (const [k, v] of Object.entries(b.adSpend).slice(0, 12)) {
      if (!/^[a-z_]{2,20}$/.test(k)) return json({ error: "bad_request", message: M.badRequest }, 400);
      const n = num(v);
      if (n !== null && n > 0) ad[k] = n;
    }
  }
  if (fee < 0 || fee > 1e9 || (aov !== null && (aov < 0 || aov > 1e7))) return json({ error: "bad_request", message: M.badRequest }, 400);
  const currency = validCurrency(String(b.currency || "")) ? b.currency : await marketCurrency(env, clientId);
  const period = typeof b.baselinePeriod === "string" ? b.baselinePeriod.trim().slice(0, 100) : "";
  await env.DB.prepare("INSERT INTO costs (client_id, campaign_id, currency, fee, ad_spend, avg_order_value, baseline_period, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(client_id, campaign_id) DO UPDATE SET currency = excluded.currency, fee = excluded.fee, ad_spend = excluded.ad_spend, avg_order_value = excluded.avg_order_value, baseline_period = excluded.baseline_period, updated_at = excluded.updated_at")
    .bind(clientId, campaignId, currency, fee, JSON.stringify(ad), aov, period, nowIso()).run();
  return json(await readCosts(env, clientId, campaignId));
}

/* The Performance numbers, shared by the panel and the client's report.
   Spec 9.4: change against before = (after minus before) divided by before; cost per enquiry
   and per new customer = (fee plus ad spend) divided by them; estimated return = new customers
   times average order value divided by (fee plus ad spend); best channel = the lowest cost
   per new customer, with new customers per channel from that channel's offer code. */
export function computeRoi({ stats, leads, baselines, costs, links }) {
  const byChannel = {};
  const ch = (c) => (byChannel[c] = byChannel[c] || { channel: c, views: 0, uniques: 0, clicks: 0, scans: 0, enquiries: 0, buttons: {} });
  const totals = { views: 0, uniques: 0, clicks: 0, scans: 0, enquiries: 0, buttons: {} };
  const days = {};
  stats.forEach((s) => {
    const c = ch(s.channel);
    days[s.day] = days[s.day] || { day: s.day, views: 0, clicks: 0, enquiries: 0 };
    if (s.type === "view") { c.views += s.n; totals.views += s.n; days[s.day].views += s.n; }
    else if (s.type === "unique") { c.uniques += s.n; totals.uniques += s.n; }
    else if (s.type === "scan") { c.scans += s.n; totals.scans += s.n; }
    else if (s.type === "form") { c.enquiries += s.n; totals.enquiries += s.n; days[s.day].enquiries += s.n; }
    else if (s.type.startsWith("click_")) {
      const btn = s.type.slice(6);
      c.clicks += s.n; totals.clicks += s.n; days[s.day].clicks += s.n;
      c.buttons[btn] = (c.buttons[btn] || 0) + s.n;
      totals.buttons[btn] = (totals.buttons[btn] || 0) + s.n;
    }
  });
  const ad = (costs && costs.adSpend) || {};
  const adTotal = Object.values(ad).reduce((a, b) => a + (Number(b) || 0), 0);
  const spend = ((costs && costs.fee) || 0) + adTotal;
  const before = (baselines && baselines.before) || {};
  const after = (baselines && baselines.after) || {};
  const change = {};
  Object.keys(before).forEach((k) => {
    if (after[k] != null && before[k] > 0) change[k] = round((after[k] - before[k]) / before[k], 4);
  });
  const enquiries = totals.enquiries || leads || 0;
  const newCustomers = after.new_customers != null ? after.new_customers : null;
  const aov = costs && costs.avgOrderValue != null ? costs.avgOrderValue : null;
  /* New customers per channel: redemptions of each channel's offer code. */
  const codeChannel = {};
  (links || []).forEach((l) => { if (l.offerCode) codeChannel[l.offerCode] = l.channel; });
  const perChannelNew = {};
  Object.keys(after).forEach((k) => {
    const m = /^redemptions-(.+)$/.exec(k);
    if (m && codeChannel[m[1]]) perChannelNew[codeChannel[m[1]]] = (perChannelNew[codeChannel[m[1]]] || 0) + after[k];
  });
  const activeChannels = Object.keys(byChannel).filter((c) => c !== "direct");
  const feeShare = activeChannels.length ? ((costs && costs.fee) || 0) / activeChannels.length : 0;
  let best = null;
  Object.values(byChannel).forEach((c) => {
    c.adSpend = Number(ad[c.channel] || 0);
    c.cost = c.channel === "direct" ? c.adSpend : c.adSpend + feeShare;
    c.newCustomers = perChannelNew[c.channel] != null ? perChannelNew[c.channel] : null;
    c.costPerEnquiry = c.enquiries ? round(c.cost / c.enquiries) : null;
    c.costPerNewCustomer = c.newCustomers ? round(c.cost / c.newCustomers) : null;
    if (c.costPerNewCustomer != null && (!best || c.costPerNewCustomer < best.value)) best = { channel: c.channel, value: c.costPerNewCustomer, basis: "new_customers" };
  });
  if (!best) {
    /* Without offer code redemptions, the channel that brought most enquiries and clicks. */
    Object.values(byChannel).forEach((c) => {
      if (c.channel === "direct") return;
      const score = c.enquiries * 10 + c.clicks + c.scans;
      if (score > 0 && (!best || score > best.score)) best = { channel: c.channel, score, basis: "actions" };
    });
  }
  return {
    totals: Object.assign({}, totals, { enquiries }),
    channels: Object.values(byChannel).sort((a, b) => b.views + b.scans - (a.views + a.scans)),
    days: Object.values(days).sort((a, b) => (a.day < b.day ? -1 : 1)),
    spend: round(spend),
    adSpend: round(adTotal),
    change,
    costPerEnquiry: enquiries && spend ? round(spend / enquiries) : null,
    costPerNewCustomer: newCustomers && spend ? round(spend / newCustomers) : null,
    estimatedReturn: newCustomers != null && aov != null && spend ? round((newCustomers * aov) / spend) : null,
    newCustomers,
    bestChannel: best ? { channel: best.channel, basis: best.basis } : null
  };
}

async function gather(env, cfg, clientId, campaignId) {
  const page = await env.DB.prepare("SELECT * FROM pages WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  const stats = page ? await all(env, "SELECT day, channel, type, n FROM daily_stats WHERE page_id = ?", page.id) : [];
  const links = page ? (await all(env, "SELECT * FROM links WHERE page_id = ?", page.id)).map((l) => linkOut(l, cfg)) : [];
  const leads = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  const baselines = await readBaselines(env, clientId, campaignId);
  const costs = await readCosts(env, clientId, campaignId);
  return { page, stats, links, leads: leads.n, baselines, costs, roi: computeRoi({ stats, leads: leads.n, baselines, costs, links }) };
}

export async function getStats(env, cfg, clientId, campaignId) {
  if (!(await campaignRow(env, clientId, campaignId))) return json({ error: "not_found", message: M.notFound }, 404);
  const g = await gather(env, cfg, clientId, campaignId);
  return json({ page: pageOut(g.page, cfg), links: g.links, baselines: g.baselines, costs: g.costs, roi: g.roi, leads: g.leads });
}

export function leadOut(r) {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    campaignName: r.cname || "",
    name: r.name,
    phone: r.phone || "",
    email: r.email || "",
    message: r.message || "",
    futureOffers: r.future_offers === 1,
    channel: r.channel || "",
    state: r.state,
    at: r.at
  };
}

export async function adminLeads(env, clientId, campaignId) {
  const rows = await all(env, "SELECT * FROM leads WHERE client_id = ? AND campaign_id = ? ORDER BY at DESC", clientId, campaignId);
  return json({ leads: rows.map(leadOut) });
}

/* ---------- client ---------- */

const NAME_SQL = "SELECT l.*, json_extract(c.data, '$.name') AS cname FROM leads l LEFT JOIN campaigns c ON c.client_id = l.client_id AND c.campaign_id = l.campaign_id WHERE l.client_id = ? ORDER BY l.at DESC";

export async function portalLeads(env, auth) {
  return json({ leads: (await all(env, NAME_SQL, auth.clientId)).map(leadOut) });
}

function csvCell(v) {
  let s = String(v == null ? "" : v);
  /* A cell starting with = + - @ would run as a formula in Excel. */
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export async function portalLeadsCsv(env, auth) {
  const rows = (await all(env, NAME_SQL, auth.clientId)).map(leadOut);
  const head = ["Datum / Date", "Kampanj / Campaign", "Namn / Name", "Telefon / Phone", "E-post / Email", "Meddelande / Message", "Vill ha erbjudanden / Wants offers", "Kanal / Channel", "Status"];
  const lines = [head.map(csvCell).join(",")].concat(rows.map((r) => [r.at.slice(0, 16).replace("T", " "), r.campaignName, r.name, r.phone, r.email, r.message, r.futureOffers ? "ja / yes" : "nej / no", r.channel, r.state === "contacted" ? "kontaktad / contacted" : "ny / new"].map(csvCell).join(",")));
  return new Response("\ufeff" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="enquiries.csv"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function patchLead(request, env, auth, leadId) {
  const b = await readJson(request, 256);
  if (!b || !["new", "contacted"].includes(b.state)) return json({ error: "bad_request", message: M.badRequest }, 400);
  const r = await env.DB.prepare("UPDATE leads SET state = ? WHERE id = ? AND client_id = ?").bind(b.state, leadId, auth.clientId).run();
  if (!r.meta || !r.meta.changes) return json({ error: "not_found", message: M.notFound }, 404);
  return json({ ok: true, state: b.state });
}

export async function deleteLead(env, auth, leadId) {
  const r = await env.DB.prepare("DELETE FROM leads WHERE id = ? AND client_id = ?").bind(leadId, auth.clientId).run();
  if (!r.meta || !r.meta.changes) return json({ error: "not_found", message: M.notFound }, 404);
  return json({ ok: true });
}

export async function portalPages(env, cfg, auth) {
  const rows = await all(env, "SELECT p.*, json_extract(c.data, '$.name') AS cname FROM pages p LEFT JOIN campaigns c ON c.client_id = p.client_id AND c.campaign_id = p.campaign_id WHERE p.client_id = ? AND p.state = 'published' ORDER BY p.published_at DESC", auth.clientId);
  return json({
    pages: rows.map((p) => {
      const o = pageOut(p, cfg);
      return { campaignId: o.campaignId, campaignName: p.cname || "", url: o.url, ended: o.ended, offerEnd: o.offerEnd, formOn: o.formOn, publishedAt: o.publishedAt };
    })
  });
}

export async function portalReport(env, cfg, auth, campaignId) {
  const row = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(auth.clientId, campaignId).first();
  if (!row) return json({ error: "not_found", message: M.notFound }, 404);
  const g = await gather(env, cfg, auth.clientId, campaignId);
  if (!g.page || g.page.state === "draft") return json({ error: "not_found", message: M.notFound }, 404);
  let name = "";
  try { name = JSON.parse(row.data).name || ""; } catch (e) {}
  const r = g.roi;
  /* Plain language only: no costs per channel, no ad spend breakdown. */
  return json({
    campaignId,
    campaignName: name,
    url: cfg.siteOrigin + "/go/" + g.page.client_slug + "/" + g.page.slug,
    offerEnd: g.page.offer_end || "",
    ended: (daysAfterEnd(g.page.offer_end) || 0) > 0,
    visits: r.totals.views,
    visitors: r.totals.uniques,
    clicks: r.totals.clicks,
    scans: r.totals.scans,
    enquiries: r.totals.enquiries,
    buttons: r.totals.buttons,
    channels: r.channels.map((c) => ({ channel: c.channel, visits: c.views, clicks: c.clicks, enquiries: c.enquiries, scans: c.scans })),
    bestChannel: r.bestChannel ? r.bestChannel.channel : null,
    baselinePeriod: g.costs.baselinePeriod,
    before: g.baselines.before,
    after: g.baselines.after,
    change: r.change
  });
}

/* ---------- daily cleanup ---------- */

export async function g2bSweep(env) {
  const today = new Date();
  const day = (offsetDays) => new Date(today.getTime() - offsetDays * 86400000).toISOString().slice(0, 10);
  const stmts = [
    /* Raw events after 90 days; daily totals stay. */
    env.DB.prepare("DELETE FROM events WHERE day < ?").bind(day(90)),
    /* Yesterday's salt and older: visitor hashes can no longer be linked across days. */
    env.DB.prepare("DELETE FROM salts WHERE day < ?").bind(day(0)),
    /* Enquiries 90 days after the offer ends. */
    env.DB.prepare("DELETE FROM leads WHERE page_id IN (SELECT id FROM pages WHERE offer_end IS NOT NULL AND offer_end < ?)").bind(day(90)),
    /* Pages are taken down 30 days after the offer ends. */
    env.DB.prepare("UPDATE pages SET state = 'unpublished', unpublished_at = ?, updated_at = ? WHERE state = 'published' AND offer_end IS NOT NULL AND offer_end < ?").bind(nowIso(), nowIso(), day(30))
  ];
  await env.DB.batch(stmts);
}
