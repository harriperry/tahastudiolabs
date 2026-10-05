/* Phase 5: offline checks of the Campaign Generator helpers (assets/growth-campaign.js) and its
   prompt file. Run: node test/campaign-helpers.test.mjs */
import fs from "node:fs";
import { campaignHtml, campaignIdFor, campaignModelSchema, cardText, defaultName, findAvoidWords, languageFromBrain, normalizeCampaign } from "../../../assets/growth-campaign.js";
import { validate } from "../src/validate.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const schema = read("../schemas/campaign.schema.json");
const model = read("./fixtures/pilot-campaign-model.json");
const meta = { clientId: "cl_chefsandy01", campaignId: "cp_2026_10_en", brainVersion: 1, name: "October campaign for Chef Sandy's Kitchen", month: "2026-10", goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"] };

const ms = campaignModelSchema(schema);
ok(!ms.properties.clientId && !ms.properties.channels && !ms.required.includes("campaignId") && ms.properties.hook, "the model sees the schema without the fields ScriptForge sets");

const raw = JSON.parse(JSON.stringify(model));
raw.clientId = "cl_wrong";
raw.shortVideo.seconds = 45;
raw.concept.title = "A Little Extra \u2014 October";
raw.socialCopy.push({ channel: "linkedin", text: "not selected", hashtags: [] });
const out = normalizeCampaign(raw, meta, schema);
const v = validate(schema, out.doc);
ok(v.valid && !out.problems.length, "a normal model answer becomes a valid campaign" + (v.valid ? "" : ": " + v.errors.join("; ")));
ok(out.doc.clientId === "cl_chefsandy01" && out.doc.status === "in_production" && out.doc.shortVideo.seconds === 30 && out.doc.shortVideo.ratio === "9:16", "ScriptForge sets client, status, 30 s and 9:16");
ok(out.doc.concept.title === "A Little Extra, October", "em-dashes are replaced");
ok(out.doc.socialCopy.map((p) => p.channel).join(",") === "instagram,facebook,google_business", "one post per selected channel, in order; unselected channels dropped");
ok(out.doc.socialCopy[0].hashtags.includes("#CameroonFood") && out.doc.socialCopy[2].hashtags.length === 0, "hashtags get a # and Google Business posts carry none");

const miss = JSON.parse(JSON.stringify(model));
miss.socialCopy = miss.socialCopy.filter((p) => p.channel !== "facebook");
const o2 = normalizeCampaign(miss, meta, schema);
ok(o2.problems.length === 1 && /facebook/.test(o2.problems[0]), "a missing channel post is reported so the retry can fix it");

const hits = findAvoidWords(Object.assign({}, out.doc, { adVariations: [{ angle: "x", headline: "Cheap eats", primaryText: "y", description: "z" }] }), ["cheap", "fast food"]);
ok(hits.adVariations && hits.adVariations[0] === "cheap" && !hits.hook, "words to avoid are found per output, case-insensitive");
ok(!findAvoidWords(out.doc, ["eat"]).hook, "a word to avoid is matched as a whole word, not inside other words");

ok(campaignIdFor("2026-10", "en", []) === "cp_2026_10_en" && campaignIdFor("2026-10", "en", ["cp_2026_10_en"]) === "cp_2026_10_en_2", "campaign ids are readable and never collide");
ok(/^cp_[a-z0-9_]{2,40}$/.test(campaignIdFor("2026-10", "both", [])), "campaign ids match the schema pattern");
ok(defaultName("2026-10", "Chef Sandy's Kitchen") === "October campaign for Chef Sandy's Kitchen", "default name in English: [Month] campaign for [Company]");
ok(defaultName("2026-10", "Bageriet", "sv") === "Oktoberkampanj för Bageriet", "default name in Swedish");
ok(languageFromBrain({ languages: ["sv", "en"] }) === "both" && languageFromBrain({ languages: ["sv"] }) === "sv" && languageFromBrain({}) === "en", "language comes from the brain");

ok(cardText("hook", out.doc.hook).startsWith("1. ") && cardText("email", out.doc.email).includes("Subject B:"), "Copy produces clean plain text");
const html = campaignHtml(Object.assign({}, out.doc, { name: "<script>x</script>" }), "Chef Sandy's Kitchen");
ok(html.startsWith("<!doctype html>") && html.includes("9. Google Business post") && !html.includes("<script>x"), "the HTML export is complete and escapes text");
ok(!/\u2014/.test(html), "the HTML export has no em-dash");

const prompt = read("../../../assets/growth/campaign.prompt.json");
ok(!/\u2014/.test(JSON.stringify(prompt)), "the campaign prompt file has no em-dash");
const sys = prompt.system.join("\n");
ok(sys.includes("{{SCHEMA}}") && sys.includes("{{LANGUAGE_RULE}}") && sys.includes("{{CHANNELS}}") && prompt.user.join("\n").includes("{{BRAIN_JSON}}") && prompt.regenerate.join("\n").includes("{{KEY}}") && prompt.retry.includes("{{ERRORS}}"), "the campaign prompt keeps its placeholders");
ok(prompt.languageRules.sv && prompt.languageRules.en && prompt.languageRules.both && prompt.goals.sales && prompt.goals.bookings && prompt.goals.awareness && prompt.goals.launch, "the prompt covers every language and goal");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
