/* ScriptForge safe reskin (after Growth Department V2 Part H): the new look must never move or
   rename what the app, the Business Brain, the Growth Clients panel and Send to ScriptForge
   depend on. Plain node, no Worker needed:
     node test/reskin.test.mjs
   It compares the page with the frozen list below (every element id ScriptForge had before the
   reskin) and checks the saved-setting names and the Growth hooks are still there. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

const page = read("scriptforge/index.html");
const app = read("assets/app.js");
const longform = read("assets/longform.js");
const growth = read("assets/growth.js");
const theme = read("assets/scriptforge-theme.css");

/* 1. Every element id from before the reskin is still on the page, exactly once. */
const FROZEN_IDS = ["aboutSection", "acctInfo", "acctStatus", "allowBRoll", "anthropicFormatOptions", "apiConfigAutoNote", "apiKey", "apiKeyDeepseek", "apiKeyGemini", "apiKeyGroq", "authEmail", "authOverlay", "authPass", "authStatus", "authTitle", "btnAccount", "btnAuthClose", "btnChangePw", "btnCharAddOutfit", "btnCharBack", "btnCharClose", "btnCharDelete", "btnCharImportBack", "btnCharImportOpen", "btnCharImportParse", "btnCharImportSave", "btnCharLib", "btnCharNew", "btnCharSave", "btnClear", "btnCopyAll", "btnDeleteAcct", "btnDeleteFinal", "btnFetchVoices", "btnForgotPw", "btnFormat", "btnLibClose", "btnLibExport", "btnLibImport", "btnLibrary", "btnLogin", "btnLongform", "btnLongformClose", "btnLongformCreate", "btnLongformNew", "btnLongformNewCancel", "btnMagic", "btnMock", "btnPdf", "btnRecommendDismiss", "btnRecommendUse", "btnSaveLib", "btnSetNewPw", "btnSignOut", "btnSignup", "btnToggleRaw", "changePwBox", "charAge", "charAnchorPreview", "charAppearance", "charDisplayName", "charElevenVoiceId", "charFormView", "charHair", "charId", "charImgFront", "charImgFrontPrev", "charImgProfile", "charImgProfilePrev", "charImgThreeQuarter", "charImgThreeQuarterPrev", "charImportPreview", "charImportSaveRow", "charImportText", "charImportView", "charList", "charListView", "charOutfitDefault", "charOutfitExtra", "charOverlay", "charProdTypes", "charTone", "charType", "charTypeList", "deepseekFormatOptions", "delPass", "deleteConfirm", "elevenLabsKey", "elevenLabsStatus", "elevenLabsVoice", "faqSection", "formatProvider", "geminiFormatOptions", "groqFormatOptions", "heygenAvatarId", "lenBadge", "libFile", "libList", "libOverlay", "longformDetailView", "longformIdea", "longformListView", "longformMock", "longformNewView", "longformOverlay", "longformProjectList", "longformTargetMinutes", "longformTargetPreview", "model", "modelDeepseek", "modelGemini", "modelGroq", "newPw", "output", "ratio", "rawOut", "recConfidence", "recCostTime", "recVideoTip", "recVoiceTip", "recWritingLabel", "recWritingReason", "recommendCard", "refImg1", "refImg1prev", "refImg2", "refImg2prev", "refImg3", "refImg3prev", "rememberElevenLabsKey", "rememberKey", "rememberKeyDeepseek", "rememberKeyGemini", "rememberKeyGroq", "rememberVideoKeyHeygen", "rememberVideoKeyVeo", "retiredProviderNotice", "retiredProviderOk", "script", "scriptType", "segCount", "status", "techSpecs", "upsell", "vidAspectRatio", "vidResolution", "videoKeyHeygen", "videoKeyVeo", "viewSignedIn", "viewSignedOut", "wordMeter"];
const ids = [...page.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const missing = FROZEN_IDS.filter((id) => !ids.includes(id));
const twice = FROZEN_IDS.filter((id) => ids.filter((x) => x === id).length > 1);
ok(missing.length === 0, "all " + FROZEN_IDS.length + " element ids are still on the page" + (missing.length ? ": missing " + missing.join(", ") : ""));
ok(twice.length === 0, "no id appears twice" + (twice.length ? ": " + twice.join(", ") : ""));

/* 2. The fields Send to ScriptForge fills keep their values and option labels. */
ok(/<select id="scriptType">[\s\S]*?<option value="Short Advert">Short Advert<\/option>/.test(page), "section 1 still offers Short Advert by that value");
ok(/<select id="ratio">[\s\S]*?<option value="9:16">/.test(page), "section 4 still offers 9:16");
ok(/<select id="segCount">[\s\S]*?<option value="3" selected>/.test(page), "section 3 still offers 3 segments, selected by default");
ok(/<textarea id="script"/.test(page), "section 5 script box is a textarea with the same id");
ok(/<select id="formatProvider">[\s\S]*?<option value="anthropic" selected>Anthropic Claude<\/option>[\s\S]*?<option value="gemini">Google Gemini \(free tier available\)<\/option>/.test(page), "section 2 provider values and labels unchanged (the Growth strip reads them)");
for (const id of ["scriptType", "ratio", "segCount", "script", "formatProvider", "btnAccount"]) {
  ok(growth.includes('"' + id + '"'), "growth.js still targets #" + id);
}
ok(/document\.querySelector\("body > header"\)/.test(growth) && /<body>\s*\n<nav class="sitenav">[\s\S]*?\n<header[ >]/.test(page), "the header is still a direct child of body (the Growth button lives there)");
ok(/document\.querySelector\("body > main"\)/.test(growth) && /\n<main>\n/.test(page), "main is still a direct child of body (the Growth panel goes before it)");

/* 3. Saved settings keep their names, so nobody loses keys, library or characters. */
const FROZEN_KEYS = ["sca_fmt_key", "sca_fmt_library", "sf_elevenlabs_key", "sf_elevenlabs_voice_id", "sf_elevenlabs_voice_name"];
for (const k of FROZEN_KEYS) ok(app.includes('"' + k + '"') || app.includes("'" + k + "'"), "saved setting name " + k + " unchanged");

/* 4. The theme is loaded on ScriptForge only, after the two existing stylesheets. */
const links = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1].replace(/\?.*$/, ""));
ok(links.join(",") === "/assets/app.css,/assets/growth.css,/assets/scriptforge-theme.css", "ScriptForge loads app.css, growth.css, then the theme");
for (const other of ["index.html", "products.html", "privacy.html", "terms.html", "story-script/index.html"]) {
  if (fs.existsSync(path.join(ROOT, other))) ok(!read(other).includes("scriptforge-theme.css"), other + " does not load the ScriptForge theme");
}
ok(/@media \(prefers-color-scheme:dark\)/.test(theme), "the theme follows the device (light and dark)");
ok(!/fonts\.googleapis|fonts\.gstatic/.test(theme + page), "fonts are self-hosted, nothing is fetched from Google");
const fontFiles = [...theme.matchAll(/url\((\/assets\/fonts\/[^)]+)\)/g)].map((m) => m[1]);
ok(fontFiles.length >= 10 && fontFiles.every((f) => fs.existsSync(path.join(ROOT, f))), "every font file the theme names exists (" + fontFiles.length + ")");
ok(!/\b(display:\s*none|visibility:\s*hidden)\b/i.test(theme), "the theme hides nothing");

/* 5. House rules on everything the reskin touched. */
const touched = { "scriptforge/index.html": page, "assets/app.js": app, "assets/longform.js": longform, "assets/scriptforge-theme.css": theme, "assets/growth.css": read("assets/growth.css") };
for (const [f, s] of Object.entries(touched)) ok(!s.includes("\u2014"), f + " has no em-dash");
const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}\u{2709}]/u;
const uiText = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\.replace\(\/[^\n]*?\/,/g, "");
ok(!emoji.test(uiText(page)), "no emoji in the page's own text");
ok(!emoji.test(uiText(app).replace(/^\s*\/\/.*$/gm, "")), "no emoji in the labels app.js writes");
ok(!emoji.test(uiText(longform).replace(/^\s*\/\/.*$/gm, "")), "no emoji in the labels longform.js writes");

/* 6. Growth panel colours follow the theme, with the old look as the fallback. */
const gcss = read("assets/growth.css");
ok(!/(^|[^,(])#F0B94A/.test(gcss) && /var\(--gold-text,#F0B94A\)/.test(gcss), "Growth gold text uses --gold-text, falling back to the old colour");
ok(/--gold-text:#8A5D08/.test(theme), "on paper, Growth gold text is the deep gold that is readable");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
