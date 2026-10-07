/* TAHA Growth Department, Markets steps 1 and 3 (hub and spoke): the markets a client can belong to.
   Shared by the Brain Vault (Worker) and the ScriptForge Growth Clients panel (browser), so both
   agree on a market's defaults and on how money is written.

   The hub is everything shared (Brain Vault, ScriptForge, prompts, design). A market (spoke) is
   only settings: its currency, time zone, default channels, default monthly fee and where page
   visitors can complain about their data. Adding a market is one entry in MARKETS.
   No em-dashes anywhere. */

export const CURRENCIES = {
  SEK: { label: "SEK", name: "Swedish krona" },
  XAF: { label: "FCFA", name: "Central African CFA franc (Cameroon)" },
  XOF: { label: "FCFA (XOF)", name: "West African CFA franc" },
  NGN: { label: "NGN", name: "Nigerian naira" },
  EUR: { label: "EUR", name: "Euro" },
  USD: { label: "USD", name: "US dollar" },
  GBP: { label: "GBP", name: "British pound" }
};

/* authority: where a page visitor can complain about personal data, in each page language.
   channels: the default channels for a new client's monthly plan and campaigns (Harry can
   change them per market in the panel's Markets view, and per client as before).
   Cameroon's Law No. 2024/017 of 23 December 2024 creates a Personal Data Protection
   Authority; it had no website yet when this was written. Nigeria: the Nigeria Data
   Protection Commission under the Nigeria Data Protection Act 2023. Have a lawyer check. */
export const MARKETS = {
  SE: {
    name: "Sweden", currency: "SEK", timeZone: "Europe/Stockholm",
    channels: ["instagram", "facebook", "google_business"],
    authority: {
      sv: "Integritetsskyddsmyndigheten (IMY)", en: "the Swedish Authority for Privacy Protection (IMY)",
      fr: "l'autorité suédoise de protection des données (IMY)", es: "la autoridad sueca de protección de datos (IMY)",
      url: "imy.se"
    }
  },
  CM: {
    name: "Cameroon", currency: "XAF", timeZone: "Africa/Douala",
    channels: ["whatsapp", "facebook", "instagram"],
    authority: {
      sv: "Kameruns myndighet för skydd av personuppgifter (lag nr 2024/017)", en: "Cameroon's Personal Data Protection Authority (Law No. 2024/017)",
      fr: "l'Autorité de protection des données à caractère personnel du Cameroun (loi n° 2024/017)", es: "la autoridad de protección de datos personales de Camerún (Ley n.º 2024/017)",
      url: ""
    }
  },
  NG: {
    name: "Nigeria", currency: "NGN", timeZone: "Africa/Lagos",
    channels: ["whatsapp", "instagram", "facebook"],
    authority: {
      sv: "Nigerias dataskyddskommission (NDPC)", en: "the Nigeria Data Protection Commission (NDPC)",
      fr: "la Commission nigériane de protection des données (NDPC)", es: "la Comisión de Protección de Datos de Nigeria (NDPC)",
      url: "ndpc.gov.ng"
    }
  }
};

export const DEFAULT_MARKET = "SE";

export function market(code) {
  return MARKETS[code] ? code : DEFAULT_MARKET;
}

export function currencyOf(code) {
  return MARKETS[market(code)].currency;
}

export function validCurrency(code) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function currencyLabel(code) {
  return (CURRENCIES[code] && CURRENCIES[code].label) || String(code || "");
}

/* Whole amounts with a space between thousands, the same on every device: "25 000 FCFA". */
export function formatMoney(v, code) {
  if (v == null || !isFinite(v)) return "-";
  const n = Math.round(Number(v));
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (n < 0 ? "-" : "") + s + " " + currencyLabel(code);
}

/* The complaint line of a page's privacy notice, in the page language (sv, en, fr, es). */
export function authorityLine(code, lang) {
  const a = MARKETS[market(code)].authority;
  const name = a[lang] || a.en;
  const where = name + (a.url ? ", " + a.url : "");
  if (lang === "sv") return "Du kan också klaga hos " + where + ".";
  if (lang === "fr") return "Vous pouvez aussi déposer une plainte auprès de " + where + ".";
  if (lang === "es") return "También puedes reclamar ante " + where + ".";
  return "You can also complain to " + where + ".";
}

/* Today's date (YYYY-MM-DD) in the market's time zone. */
export function marketDate(code, ms) {
  const tz = MARKETS[market(code)].timeZone;
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms == null ? Date.now() : ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return g("year") + "-" + g("month") + "-" + g("day");
}

/* A market with Harry's saved settings (fee, channels) over the defaults above.
   saved: a row of market_settings or null. */
export function marketWithSettings(code, saved) {
  const m = MARKETS[market(code)];
  let channels = m.channels;
  try { if (saved && saved.channels) { const c = JSON.parse(saved.channels); if (Array.isArray(c) && c.length) channels = c; } } catch (e) {}
  return { code: market(code), name: m.name, currency: m.currency, timeZone: m.timeZone, channels, fee: saved && saved.fee != null ? saved.fee : 0, authority: m.authority.en + (m.authority.url ? ", " + m.authority.url : "") };
}

/* For the panel's pickers. */
export function marketList(savedRows) {
  const by = {};
  (savedRows || []).forEach((r) => { by[r.code] = r; });
  return Object.keys(MARKETS).map((code) => marketWithSettings(code, by[code] || null));
}

export function currencyList() {
  return Object.keys(CURRENCIES).map((code) => ({ code, label: CURRENCIES[code].label, name: CURRENCIES[code].name }));
}
