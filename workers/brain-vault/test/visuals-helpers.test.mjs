/* V2 phase G1 test: the Visual Pack helpers, the prompt, platforms.json and the campaign-2
   schema. Plain node, no Worker needed:
     node test/visuals-helpers.test.mjs */
import fs from "node:fs";
import { validate } from "../src/validate.js";
import {
  briefModelSchema,
  briefsFor,
  buildSlots,
  checkVisuals,
  copyText,
  kitFromBrandJson,
  normalizeVisuals,
  overlayText,
  packSummary,
  photoList,
  textInPrompt,
  withVisuals
} from "../../../assets/growth-visuals.js";
import { campaignModelSchema, normalizeCampaign } from "../../../assets/growth-campaign.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));

const schema = read("../schemas/campaign.schema.json");
const platforms = read("../../../assets/growth/platforms.json");
const prompt = read("../../../assets/growth/visuals.prompt.json");
const brain = read("./fixtures/pilot-brain-v1.json");
const model = read("./fixtures/pilot-campaign-model.json");
const CHANNELS = ["instagram", "facebook", "tiktok", "google_business", "email"];

function pilot(extra = {}) {
  const m = JSON.parse(JSON.stringify(model));
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId: "cl_test1", campaignId: "cp_2026_10_en", brainVersion: 1, name: "A Little Extra", month: "2026-10", goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m, extra);
}

/* A stand-in model answer: one good item per slot. Product shots use the first photo. */
export function fakeAnswer(slots, photoIds, opts = {}) {
  return {
    visuals: slots.map((s, i) => {
      const product = /offer|social|gbp|ad_1|video_cover$/.test(s.id);
      return {
        id: s.id,
        subject: product ? "product" : s.id === "v_lp_hero" || s.id === "v_ad_2" ? "people" : "mood",
        source: product ? "client_photo" : "ai_image",
        photo_ref: product ? (opts.noPhotos ? null : photoIds[i % photoIds.length] || null) : null,
        cast: s.id === "v_lp_hero" || s.id === "v_ad_2" ? "Two young professionals in their twenties from Buea, casual smart clothes" : "",
        prompt: product
          ? "Crop the client's photo to " + s.ratio + ", lift the shadows slightly, extend the warm wooden table to the left so the top fifth stays calm and empty."
          : "Evening street in Buea with warm string lights, steam rising from a pot, golden hour light, accents of #F0B84C and #7A1E1E, leave the top fifth as calm empty background, shot on a 35mm lens, candid. " + prompt.noTextSentence,
        avoid: "text, logos, watermarks, plastic-looking food",
        overlay: { headline: "A little extra", sub: "Free protein bites with every double order", cta: "Order now" },
        alt_text: { sv: "En tallrik med stekta plantains.", en: "A plate of fried plantains." }
      };
    })
  };
}

try {
  /* platforms.json */
  const enumKeys = schema.properties.visuals.items.properties.platform.enum;
  ok(JSON.stringify(Object.keys(platforms.platforms).sort()) === JSON.stringify(enumKeys.slice().sort()), "platforms.json and the schema list the same platforms");
  const ratioOk = Object.values(platforms.platforms).every((p) => {
    const [a, b] = p.ratio.split(":").map(Number);
    return Math.abs(p.width / p.height - a / b) < 0.02;
  });
  ok(ratioOk, "every platform size matches its ratio");
  ok(platforms.platforms.instagram_feed.width === 1080 && platforms.platforms.instagram_feed.height === 1350 && /1012 x 1350/.test(platforms.platforms.instagram_feed.clear_zone), "Instagram feed is 1080 x 1350 with the 3:4 grid crop");
  ok(platforms.platforms.instagram_story.clear.top === 270 && platforms.platforms.instagram_story.clear.bottom === 672 && platforms.platforms.instagram_story.clear.left === 65, "Story and Reel cover use the March 2026 Meta margins");
  const tt = platforms.platforms.tiktok_cover.clear;
  ok(tt.top === 130 && tt.bottom === 484 && tt.left === 44 && tt.right === 140, "TikTok uses the 2026 safe zone");
  ok(platforms.platforms.google_business.width === 1200 && platforms.platforms.google_business.height === 900 && /900 x 900/.test(platforms.platforms.google_business.clear_zone), "Google Business 1200 x 900, centre 900 x 900");
  ok(platforms.platforms.linkedin_portrait && platforms.platforms.instagram_feed_3x4, "new LinkedIn portrait and Instagram 3:4 sizes exist");
  ok(platforms.changes.length >= 4 && platforms.checked === "2026-10-06", "platforms.json records what changed and when it was checked");

  /* campaign-1 stays valid, campaign-2 is valid */
  const c1 = pilot();
  ok(validate(schema, c1).valid, "a campaign-1 document (no visuals) is still valid");
  ok(!campaignModelSchema(schema).properties.visuals && !campaignModelSchema(schema).properties.visualsMadeAt, "the campaign prompt never asks the model for visuals");

  /* slots */
  const doc = pilot({ channels: CHANNELS, socialCopy: CHANNELS.map((c) => ({ channel: c, text: "Post for " + c, hashtags: c === "google_business" || c === "email" ? [] : ["#buea"] })) });
  const slots = buildSlots(doc, platforms);
  const keys = slots.map((s) => s.output_key);
  ok(["offer", "shortVideo.cover", "shortVideo.cover_tiktok", "socialCopy.instagram", "socialCopy.facebook", "socialCopy.tiktok", "adVariations.1", "adVariations.5", "landingPage.hero", "landingPage.og", "email", "googleBusinessPost"].every((k) => keys.includes(k)), "every output that needs an image gets a brief, including a cover for the video");
  ok(new Set(slots.map((s) => s.id)).size === slots.length, "brief ids are unique");
  ok(slots.every((s) => { const p = platforms.platforms[s.platform]; return s.width === p.width && s.height === p.height && s.ratio === p.ratio && s.clear_zone === p.clear_zone; }), "every brief has its platform's size and clear zone");
  ok(slots.filter((s) => s.output_key.startsWith("adVariations")).every((s) => s.platform === "facebook_feed"), "ads use the size of the first paid channel (Facebook here)");
  ok(new Set(slots.filter((s) => s.output_key.startsWith("adVariations")).map((s) => s.angle)).size === 3, "ad briefs rotate product, person and setting");
  ok(!keys.includes("socialCopy.google_business") && !keys.includes("socialCopy.email"), "Google Business and email posts share their output's own brief");
  ok(!buildSlots(pilot(), platforms).some((s) => s.output_key === "shortVideo.cover_tiktok"), "no TikTok cover when TikTok is not a channel");

  /* model schema */
  const ms = briefModelSchema(schema);
  ok(!ms.properties.width && !ms.properties.platform && ms.required.includes("subject") && ms.properties.prompt, "the model writes the brief, ScriptForge sets the size");

  /* normalize */
  const photos = photoList([{ id: "f_dish1abcd", section: "pictures", name: "plantains.jpg" }, { id: "f_dish2abcd", section: "pictures", name: "eru.jpg" }, { id: "f_story1abc", section: "founderStory", name: "story.pdf" }], { imageNotes: [{ fileId: "f_dish1abcd", caption: "Fried plantains on a plate", bestUse: "feed" }] });
  ok(photos.length === 2 && photos[0].caption === "Fried plantains on a plate", "the photo list holds the client's pictures with the brain's captions");
  const ids = photos.map((p) => p.fileId);
  const nctx = { photoIds: ids, language: "en", noTextSentence: prompt.noTextSentence, avoidDefault: prompt.avoidDefault };
  let out = normalizeVisuals(fakeAnswer(slots, ids), slots, nctx);
  ok(out.problems.length === 0, "a good answer has no problems" + (out.problems.length ? ": " + out.problems.join("; ") : ""));
  ok(checkVisuals(schema, out.visuals).length === 0, "a good answer passes the campaign-2 schema" + (checkVisuals(schema, out.visuals).length ? ": " + checkVisuals(schema, out.visuals).slice(0, 3).join("; ") : ""));
  ok(out.visuals.every((v, i) => v.width === slots[i].width && v.platform === slots[i].platform), "sizes come from platforms.json, whatever the model says");
  const c2 = withVisuals(doc, out.visuals, "2026-10-06T08:00:00.000Z");
  ok(c2.schemaVersion === "campaign-2" && validate(schema, c2).valid, "the campaign with its Visual Pack is a valid campaign-2 document");
  ok(normalizeCampaign(c2, { clientId: c2.clientId, campaignId: c2.campaignId, brainVersion: 1, name: c2.name, month: c2.month, goal: c2.goal, language: "en", channels: c2.channels }, schema).doc.schemaVersion === "campaign-2", "regenerating a card keeps campaign-2");
  ok(out.visuals.filter((v) => v.source === "ai_image").every((v) => v.prompt.endsWith(prompt.noTextSentence)), "every AI prompt ends with the no text sentence");
  ok(out.visuals.every((v) => /\btext\b/.test(v.avoid)), "every brief avoids text");

  const bad = fakeAnswer(slots, ids);
  bad.visuals[0].source = "ai_image";
  bad.visuals[0].photo_ref = null;
  bad.visuals[0].subject = "product";
  bad.visuals[1].photo_ref = "f_invented99";
  bad.visuals.find((v) => v.subject === "mood").prompt = "A chalkboard sign that reads \"A little extra\" above the counter";
  bad.visuals.pop();
  out = normalizeVisuals(bad, slots, nctx);
  ok(out.visuals[0].source === "client_photo", "a product shot is always a client photo");
  ok(out.visuals[1].photo_ref === null && out.fixes.some((f) => /f_invented99/.test(f)), "an invented photo id becomes Photo needed from client");
  ok(out.problems.some((p) => /text, a sign or a logo|quotes words/.test(p)), "a prompt that writes words into the image is a problem for the retry");
  ok(out.problems.some((p) => /missing/.test(p)), "a missing brief is a problem for the retry");
  const noCast = fakeAnswer(slots, ids);
  noCast.visuals.find((v) => v.id === "v_lp_hero").cast = "";
  ok(normalizeVisuals(noCast, slots, nctx).problems.some((p) => /cast/.test(p)), "people without a cast from the brain is a problem");
  const noPhotos = normalizeVisuals(fakeAnswer(slots, [], { noPhotos: true }), slots, Object.assign({}, nctx, { photoIds: [] }));
  ok(noPhotos.visuals.filter((v) => v.subject === "product").every((v) => v.source === "client_photo" && v.photo_ref === null), "with no client photos every product shot shows Photo needed from client");
  const both = normalizeVisuals(fakeAnswer(slots, ids), slots, Object.assign({}, nctx, { language: "both" }));
  ok(both.problems.some((p) => /overlay_alt/.test(p)), "a Swedish and English campaign needs the English overlay too");

  /* text check */
  ok(textInPrompt("Steam over a pot. Leave the top fifth as calm, empty background. " + prompt.noTextSentence, {}, prompt.noTextSentence).length === 0, "the no text sentence and the clear zone wording pass");
  ok(textInPrompt("A neon sign that says OPEN", {}, "").length > 0, "a sign that says something is caught");
  ok(textInPrompt("A table, headline A little extra in gold", { headline: "A little extra" }, "").some((r) => /overlay headline/.test(r)), "the overlay headline inside the prompt is caught");
  ok(textInPrompt("A woman reading on a bench, warm textured wall", {}, "").length === 0, "ordinary words like reading and textured are not flagged");

  /* cards and copy */
  const v0 = c2.visuals[0];
  const ct = copyText(v0, "plantains.jpg");
  ok(ct.includes(v0.width + " x " + v0.height) && ct.includes(v0.clear_zone) && ct.includes("EDIT THE CLIENT PHOTO"), "Copy prompt carries the size and the clear zone");
  const need = Object.assign({}, v0, { photo_ref: null });
  ok(copyText(need).startsWith("PHOTO NEEDED FROM CLIENT"), "a missing photo copies as a photo request");
  ok(overlayText(v0).includes("Order now"), "Copy overlay carries the button text");
  ok(briefsFor(c2, "adVariations").length === 5 && briefsFor(c2, "socialCopy").length === 3 && briefsFor(c2, "shortVideo").length === 2, "briefs sit under the right output cards");
  const sum = packSummary(c2, [{ visualId: c2.visuals[0].id }, { visualId: c2.visuals[1].id }, { visualId: c2.visuals[1].id }]);
  ok(sum.briefs === c2.visuals.length && sum.images === 3 && sum.withImage === 2, "the pack summary counts briefs and attached images");

  /* brand kit import (D:\BRAND-KITS brand.json format) */
  const kit = kitFromBrandJson({ slug: "chef-sandys-kitchen", name: "Chef Sandy's Kitchen", palette: { light: "#FFF6E6", accent: "#F0B84C", pill: "#7A1E1E", scrim: "#120804" }, fonts: { bold: "fonts/Poppins-Bold.ttf", serif: "fonts/Lora-Italic.ttf" }, logo_files: { notes: "Gold on transparent. Use on dark backings." } });
  ok(kit.colors.length === 4 && kit.colors[1].hex === "#F0B84C" && kit.fonts.includes("Poppins Bold") && /dark backings/.test(kit.logoNotes), "a BRAND-KITS brand.json becomes a brand kit");

  /* no em-dashes in anything G1 ships */
  const files = ["../../../assets/growth-visuals.js", "../../../assets/growth/visuals.prompt.json", "../../../assets/growth/platforms.json", "../src/delivery.js", "../schemas/campaign.schema.json"];
  const dashed = files.filter((f) => fs.readFileSync(new URL(f, import.meta.url), "utf8").includes("\u2014"));
  ok(dashed.length === 0, "no em-dashes in the G1 files" + (dashed.length ? ": " + dashed.join(", ") : ""));
  ok(!JSON.stringify(c2).includes("\u2014"), "no em-dashes in a generated Visual Pack");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
