/* TAHA Growth Department V2 Part D: the results questions per business type, shared by the
   Brain Vault Worker (checks and the prompt text) and the ScriptForge panel (the Results box).
   The client portal shows the same fields with its own Swedish and English labels (i18n.json,
   "results").

   Spec table (open item 2): restaurant and cafe ask for orders or covers, salon and barber for
   bookings; both ask new customers, offer redemptions, referrals and the best performing post.
   Any business can add a free text of what customers said. Every answer is optional.
   No em-dashes anywhere. */

export const NICHES = [
  ["restaurant", "Restaurant or cafe"],
  ["salon", "Salon or barber"],
  ["other", "Other business"]
];

const COMMON = [
  { key: "newCustomers", type: "int", label: { restaurant: "New customers", salon: "New clients", other: "New customers" } },
  { key: "redemptions", type: "int", label: "Offer redemptions" },
  { key: "referrals", type: "int", label: "Referrals" },
  { key: "bestPost", type: "post", label: "Best performing post" }
];

export const RESULT_FIELDS = {
  restaurant: [{ key: "orders", type: "int", main: true, label: "Orders or covers this month" }].concat(COMMON),
  salon: [{ key: "bookings", type: "int", main: true, label: "Bookings this month" }].concat(COMMON),
  other: [{ key: "customers", type: "int", main: true, label: "Customers or sales this month" }].concat(COMMON)
};

/* The free text every business can add. */
export const SAID = { key: "said", type: "text", label: "What customers said", max: 1000 };

export const POST_CHANNELS = ["instagram", "facebook", "tiktok", "linkedin", "google_business", "email", "landing_page", "other"];
export const POST_LABEL = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", google_business: "Google Business", email: "Email", landing_page: "Landing page", other: "Something else" };
export const MAX_NUMBER = 10000000;

export function niche(n) {
  return RESULT_FIELDS[n] ? n : "other";
}

export function fieldsFor(n) {
  return RESULT_FIELDS[niche(n)].map((f) => Object.assign({}, f, { label: typeof f.label === "string" ? f.label : f.label[niche(n)] })).concat([SAID]);
}

export function mainField(n) {
  return RESULT_FIELDS[niche(n)][0];
}

/* Checks and cleans one set of answers. Empty answers are left out (every field is optional).
   Returns { values, errors }. */
export function cleanResults(n, input) {
  const values = {};
  const errors = [];
  const src = input && typeof input === "object" ? input : {};
  for (const f of fieldsFor(n)) {
    const v = src[f.key];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "int") {
      const num = typeof v === "number" ? v : /^\s*\d+\s*$/.test(String(v)) ? parseInt(String(v), 10) : NaN;
      if (!Number.isInteger(num) || num < 0 || num > MAX_NUMBER) errors.push(f.key + " must be a whole number from 0");
      else values[f.key] = num;
    } else if (f.type === "post") {
      if (!POST_CHANNELS.includes(v)) errors.push(f.key + " must be one of " + POST_CHANNELS.join(", "));
      else values[f.key] = v;
    } else {
      const s = String(v).replace(/\s*\u2014\s*/g, ", ").replace(/\s+\n/g, "\n").trim();
      if (s.length > (f.max || 1000)) errors.push(f.key + " is too long");
      else if (s) values[f.key] = s;
    }
  }
  return { values, errors };
}

/* Harry's corrections win over the client's answers, field by field. */
export function effective(clientValues, harryValues) {
  return Object.assign({}, clientValues || {}, harryValues || {});
}

/* One line for the Campaign Generator prompt ({{LAST_RESULTS}}). */
export function reportedText(n, values, note) {
  const parts = [];
  for (const f of fieldsFor(n)) {
    const v = values && values[f.key];
    if (v === undefined) continue;
    if (f.type === "int") parts.push(f.label.toLowerCase() + " " + v);
    else if (f.type === "post") parts.push("best performing post " + (POST_LABEL[v] || v));
  }
  const bits = [];
  if (parts.length) bits.push("the client reported " + parts.join(", "));
  if (values && values.said) bits.push("customers said: \"" + String(values.said).slice(0, 300) + "\"");
  if (note) bits.push("Harry's note: " + String(note).slice(0, 400));
  return bits.join("; ");
}
