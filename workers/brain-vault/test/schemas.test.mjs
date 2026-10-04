/* Checks the three JSON Schemas with the shared validator: the pilot intake for
   Chef Sandy's Kitchen (spec section 11) must pass, and broken documents must fail.
   Run: node test/schemas.test.mjs */
import fs from "node:fs";
import { validate } from "../src/validate.js";

const load = (n) => JSON.parse(fs.readFileSync(new URL("../schemas/" + n + ".schema.json", import.meta.url)));
const intakeS = load("intake");
const brainS = load("brain");
const campaignS = load("campaign");
const pilot = JSON.parse(fs.readFileSync(new URL("./fixtures/pilot-intake-v1.json", import.meta.url)));
let pass = 0;
let fail = 0;
function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log("PASS " + name);
  } else {
    fail++;
    console.log("FAIL " + name + (extra ? " " + JSON.stringify(extra) : ""));
  }
}
const clone = (o) => JSON.parse(JSON.stringify(o));

let r = validate(intakeS, pilot);
ok(r.valid, "pilot intake v1 (Chef Sandy's Kitchen) is valid", r.errors);

let bad = clone(pilot);
bad.profile.brandVoice.toneChips = ["angry"];
ok(!validate(intakeS, bad).valid, "unknown tone chip rejected");
bad = clone(pilot);
bad.uploads.pictures.push({ fileId: "f_abcd1234", name: "clip.mp4", mime: "video/mp4" });
ok(!validate(intakeS, bad).valid, "video file rejected");
bad = clone(pilot);
bad.uploads.pictures = Array.from({ length: 21 }, (_, i) => ({ fileId: "f_pic" + i + "aaaa", name: "p.jpg", mime: "image/jpeg" }));
ok(!validate(intakeS, bad).valid, "more than 20 pictures rejected");
bad = clone(pilot);
bad.apiKey = "sk-ant-xxx";
ok(!validate(intakeS, bad).valid, "unknown fields (such as an API key) rejected");
bad = clone(pilot);
delete bad.profile.usp;
ok(!validate(intakeS, bad).valid, "missing profile field rejected");

const brain = {
  schemaVersion: "brain-1",
  clientId: pilot.clientId,
  brainVersion: 1,
  builtFromIntakeVersion: 1,
  createdAt: "2026-10-06T10:00:00Z",
  languages: ["en"],
  positioning: { oneLiner: "Destination-grade West African home cooking, a text away.", category: "Home-cooked meal delivery", differentiators: ["Absolute hygiene", "Open 8 AM to 10 PM"] },
  personas: [{ name: "Busy student", who: "University of Buea student", wants: "Quick, reliable, nutritious meals", fears: "Unhygienic food", whereTheyAre: ["Instagram", "WhatsApp"] }],
  voice: { summary: "Friendly, efficient, energizing and honest.", do: ["Short sentences"], dont: ["Corporate jargon"], sampleLines: ["Let's eat!"] },
  words: { use: ["Rich. Spicy. Tender."], avoid: [] },
  proofPoints: [{ claim: "Cooked fresh, delivered hot", source: "usp" }],
  offers: [{ name: "Refer 10, eat free", terms: "Refer 10 customers, get your next plate free", validUntil: "" }],
  competitorGaps: [],
  founderStory: { short: "The Recipe for Independence.", long: "" },
  faqBank: [],
  contentPillars: ["Behind the stove", "Customer comfort"],
  imageNotes: [{ fileId: "f_pic1aaaa", caption: "Grilled skewers", bestUse: "Hook frame" }],
  editedByHarry: true
};
r = validate(brainS, brain);
ok(r.valid, "sample brain v1 is valid", r.errors);
bad = clone(brain);
bad.proofPoints[0].source = "rumour";
ok(!validate(brainS, bad).valid, "brain with bad proof source rejected");

const campaign = {
  schemaVersion: "campaign-1",
  clientId: pilot.clientId,
  campaignId: "cp_2026_10",
  brainVersion: 1,
  name: "October campaign for Chef Sandy's Kitchen",
  month: "2026-10",
  goal: "bookings",
  language: "en",
  channels: ["instagram", "facebook"],
  concept: { title: "Comfort on your plate", bigIdea: "Your kitchen with you everywhere", whyNow: "Exam season", keyMessage: "Hot, clean, a text away" },
  hook: ["h1", "h2", "h3", "h4", "h5"],
  offer: { framing: "Refer 10, eat free", terms: "Next plate free", deadline: "31 October", riskReversal: "Not hot? Next one is on us." },
  shortVideo: { ratio: "9:16", seconds: 30, script: "SEGMENT 1 ..." },
  socialCopy: [{ channel: "instagram", text: "Rich. Spicy. Tender.", hashtags: ["#Buea"] }],
  adVariations: [1, 2, 3, 4, 5].map((i) => ({ angle: "a" + i, headline: "h", primaryText: "p", description: "d" })),
  cta: [{ text: "Order now", button: "Order" }, { text: "Text us", button: "Text" }, { text: "Book a tray", button: "Book" }],
  landingPage: { headline: "h", subheadline: "s", benefits: [{ title: "a", text: "t" }, { title: "b", text: "t" }, { title: "c", text: "t" }], proof: [], faq: [], cta: "Order" },
  email: { subjects: ["s1", "s2"], preview: "p", body: "b", cta: "c" },
  googleBusinessPost: { text: "t", ctaType: "ORDER" },
  status: "in_production"
};
r = validate(campaignS, campaign);
ok(r.valid, "sample campaign is valid", r.errors);
bad = clone(campaign);
bad.hook.pop();
ok(!validate(campaignS, bad).valid, "campaign with 4 hooks rejected");
bad = clone(campaign);
bad.shortVideo.ratio = "16:9";
ok(!validate(campaignS, bad).valid, "campaign short video must be 9:16");

for (const [n, s] of [["intake", intakeS], ["brain", brainS], ["campaign", campaignS]]) {
  ok(!/\u2014/.test(JSON.stringify(s)), n + " schema has no em-dash");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
