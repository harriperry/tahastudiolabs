/* TAHA Growth Department, Markets step 2: the campaign languages.
   Shared by the Brain Vault (Worker), the client portal's checks and the ScriptForge Growth
   Clients panel (browser), so all agree on which languages exist, which ones go to a human
   language reviewer, and which language a campaign page's own words (buttons, form, privacy
   notice) are written in.

   review: true means a recruited reviewer checks the texts before they reach customers
   (Harry approves the others himself). page: the language of the page's own words; the two
   Pidgins use English buttons and notices, which their readers read every day.
   "both" is the older Swedish and English campaign: reviewed as Swedish, page in Swedish.
   Adding a language is one line here plus its prompt rules in assets/growth/*.prompt.json.
   No em-dashes anywhere. */

export const LANGUAGES = {
  en: { name: "English", sv: "Engelska", own: "English", page: "en", locale: "en-GB", review: false },
  sv: { name: "Swedish", sv: "Svenska", own: "Svenska", page: "sv", locale: "sv-SE", review: true },
  fr: { name: "French", sv: "Franska", own: "Français", page: "fr", locale: "fr-FR", review: false },
  es: { name: "Spanish", sv: "Spanska", own: "Español", page: "es", locale: "es-ES", review: true },
  pcm: { name: "Nigerian Pidgin", sv: "Nigeriansk pidgin", own: "Naija", page: "en", locale: "en-GB", review: false },
  wes: { name: "Cameroonian Pidgin", sv: "Kamerunsk pidgin", own: "Kamtok", page: "en", locale: "en-GB", review: false }
};

/* What a campaign (and the intake's campaign language) can be, in the order the pickers show. */
export const CAMPAIGN_LANGUAGES = ["en", "sv", "both", "fr", "es", "pcm", "wes"];

export const REVIEW_LANGUAGES = Object.keys(LANGUAGES).filter((k) => LANGUAGES[k].review);
export const PAGE_LANGUAGES = ["sv", "en", "fr", "es"];

export function validCampaignLanguage(code) {
  return CAMPAIGN_LANGUAGES.includes(code);
}

export function campaignLanguageName(code, ui) {
  if (code === "both") return ui === "sv" ? "Svenska och engelska" : "Swedish and English";
  const l = LANGUAGES[code];
  if (!l) return String(code || "");
  return ui === "sv" ? l.sv : l.name;
}

/* The language a human reviewer checks for this campaign language, or null when Harry
   approves it himself. */
export function reviewLanguage(code) {
  if (code === "both") return "sv";
  return LANGUAGES[code] && LANGUAGES[code].review ? code : null;
}

/* The language of a campaign page's own words. */
export function pageLanguage(code) {
  if (code === "both") return "sv";
  return LANGUAGES[code] ? LANGUAGES[code].page : "en";
}

export function localeOf(code) {
  return LANGUAGES[code] ? LANGUAGES[code].locale : "en-GB";
}

/* brain.languages for a campaign language, and back. */
export function brainLanguages(code) {
  if (code === "both") return ["sv", "en"];
  return LANGUAGES[code] ? [code] : ["en"];
}

export function campaignLanguageFromBrain(langs) {
  const l = Array.isArray(langs) ? langs : [];
  if (l.includes("sv") && l.includes("en")) return "both";
  const first = l.find((x) => LANGUAGES[x]);
  return first || "en";
}

/* For the panel's pickers. */
export function campaignLanguageList() {
  return CAMPAIGN_LANGUAGES.map((code) => ({ code, name: campaignLanguageName(code, "en"), review: !!reviewLanguage(code) }));
}
