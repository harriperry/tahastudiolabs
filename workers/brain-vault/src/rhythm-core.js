/* V2 Part C: the monthly rhythm, pure helpers (no Worker imports), shared by src/rhythm.js and
   the plain node tests. See src/rhythm.js for the rules. */

export const PLAN_CHANNELS = ["instagram", "facebook", "tiktok", "linkedin", "google_business", "email"];
export const PLAN_GOALS = ["awareness", "bookings", "sales", "launch"];
export const DUE_WINDOW_DAYS = 7;
export const REMINDER_DAY = 20;
const TZ = "Europe/Stockholm";

/* ---------- pure date helpers (exported for the tests) ---------- */

/* The calendar date in Stockholm for a moment in time. */
export function stockholmDate(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t).value;
  const y = +get("year"), m = +get("month"), d = +get("day");
  return { y, m, d, iso: get("year") + "-" + get("month") + "-" + get("day"), month: get("year") + "-" + get("month") };
}

export function addMonths(month, n) {
  const [y, m] = String(month).split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0");
}

function dayNumber(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/* The day a campaign for `month` should be ready: readyDay of the month before. */
export function dueDateFor(month, readyDay) {
  return addMonths(month, -1) + "-" + String(readyDay).padStart(2, "0");
}

export function defaultPlan(createdAt, todayMonth) {
  /* A client's first rhythm month is the one after they joined, never earlier than next month. */
  const joined = String(createdAt || "").slice(0, 7);
  const first = /^\d{4}-\d{2}$/.test(joined) ? addMonths(joined, 1) : addMonths(todayMonth, 1);
  return { perMonth: 1, readyDay: 25, channels: ["instagram", "facebook", "google_business"], goal: "sales", active: true, startMonth: first, saved: false };
}

/* The next campaign that is due, or null when the client is ahead. counts: { "YYYY-MM": n }. */
export function nextDue(plan, counts, todayIso) {
  const todayMonth = todayIso.slice(0, 7);
  let m = plan.startMonth && plan.startMonth > todayMonth ? plan.startMonth : todayMonth;
  const last = addMonths(todayMonth, 1);
  for (; m <= last; m = addMonths(m, 1)) {
    const have = counts[m] || 0;
    if (have < plan.perMonth) {
      const dueDate = dueDateFor(m, plan.readyDay);
      const daysLeft = dayNumber(dueDate) - dayNumber(todayIso);
      return { month: m, dueDate, daysLeft, overdue: daysLeft < 0, have, need: plan.perMonth };
    }
  }
  return null;
}

export function validatePlan(p) {
  const errors = [];
  if (!p || typeof p !== "object") return { errors: ["plan must be an object"] };
  const perMonth = Number(p.perMonth);
  const readyDay = Number(p.readyDay);
  if (!Number.isInteger(perMonth) || perMonth < 1 || perMonth > 4) errors.push("perMonth must be 1 to 4");
  if (!Number.isInteger(readyDay) || readyDay < 1 || readyDay > 28) errors.push("readyDay must be 1 to 28");
  const channels = Array.isArray(p.channels) ? PLAN_CHANNELS.filter((c) => p.channels.includes(c)) : [];
  if (!channels.length || channels.length !== new Set(p.channels).size) errors.push("channels must be one or more of " + PLAN_CHANNELS.join(", "));
  if (!PLAN_GOALS.includes(p.goal)) errors.push("goal must be one of " + PLAN_GOALS.join(", "));
  if (typeof p.active !== "boolean") errors.push("active must be true or false");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.startMonth || ""))) errors.push("startMonth must be YYYY-MM");
  return errors.length ? { errors } : { plan: { perMonth, readyDay, channels, goal: p.goal, active: p.active, startMonth: p.startMonth } };
}

const CH = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", google_business: "Google Business", email: "Email", qr: "QR code", share: "shared link", direct: "direct" };

export function resultsText(list) {
  if (!list.length) return "No results yet from earlier campaigns. Write from the Business Brain alone.";
  return list.map((r) => {
    const t = r.roi.totals;
    const bits = [];
    bits.push(r.name + " (" + r.month + ", goal " + r.goal + (r.offer ? ", offer: " + r.offer : "") + ")");
    if (r.hasPage) {
      bits.push("landing page: " + t.views + " views, " + t.clicks + " button clicks, " + t.scans + " QR scans, " + t.enquiries + " enquiries");
      const top = r.roi.channels.filter((c) => c.channel !== "direct" && (c.views || c.clicks || c.enquiries)).slice(0, 3)
        .map((c) => (CH[c.channel] || c.channel) + " " + c.views + " views/" + c.clicks + " clicks/" + c.enquiries + " enquiries");
      if (top.length) bits.push("by channel: " + top.join("; "));
    } else bits.push("no landing page tracked");
    if (r.roi.bestChannel) bits.push("best channel: " + (CH[r.roi.bestChannel.channel] || r.roi.bestChannel.channel) + (r.roi.bestChannel.basis === "new_customers" ? " (lowest cost per new customer)" : " (most actions)"));
    const ch = Object.entries(r.roi.change || {}).map(([k, v]) => k.replace(/_/g, " ") + " " + (v >= 0 ? "+" : "") + Math.round(v * 100) + "%");
    if (ch.length) bits.push("change against before: " + ch.join(", "));
    if (r.roi.newCustomers != null) bits.push("new customers: " + r.roi.newCustomers);
    if (r.roi.costPerNewCustomer != null) bits.push("cost per new customer: " + r.roi.costPerNewCustomer);
    return "- " + bits.join("; ") + ".";
  }).join("\n");
}

