/* TAHA Growth Department, Markets step 1 (hub and spoke): the markets a client can belong to.
   Shared by the Brain Vault (Worker) and the ScriptForge Growth Clients panel (browser), so both
   agree on a market's defaults and on how money is written.

   The hub is everything shared (Brain Vault, ScriptForge, prompts, design). A market (spoke) is
   only settings: for now its currency; time zone, languages, channels and privacy wording follow
   in later steps. Adding a market is one line in MARKETS. No em-dashes anywhere. */

export const CURRENCIES = {
  SEK: { label: "SEK", name: "Swedish krona" },
  XAF: { label: "FCFA", name: "Central African CFA franc (Cameroon)" },
  XOF: { label: "FCFA (XOF)", name: "West African CFA franc" },
  NGN: { label: "NGN", name: "Nigerian naira" },
  EUR: { label: "EUR", name: "Euro" },
  USD: { label: "USD", name: "US dollar" },
  GBP: { label: "GBP", name: "British pound" }
};

export const MARKETS = {
  SE: { name: "Sweden", currency: "SEK", timeZone: "Europe/Stockholm" },
  CM: { name: "Cameroon", currency: "XAF", timeZone: "Africa/Douala" },
  NG: { name: "Nigeria", currency: "NGN", timeZone: "Africa/Lagos" }
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

/* For the panel's pickers. */
export function marketList() {
  return Object.keys(MARKETS).map((code) => ({ code, name: MARKETS[code].name, currency: MARKETS[code].currency }));
}

export function currencyList() {
  return Object.keys(CURRENCIES).map((code) => ({ code, label: CURRENCIES[code].label, name: CURRENCIES[code].name }));
}
