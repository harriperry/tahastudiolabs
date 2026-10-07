/* V2 phase G1 test: campaign-2 documents, finished images (deliveries) and the brand kit in
   the Brain Vault. Same local setup as campaign.test.mjs (Vault behind the local site on
   port 8080, started by test/run-all.mjs):
     DEV_LOG=dev.log PERSIST=.wrangler/state WRANGLER=./node_modules/.bin/wrangler node test/visuals.test.mjs */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSlots, normalizeVisuals, withVisuals } from "../../../assets/growth-visuals.js";

const BASE = process.env.VAULT_URL || "http://127.0.0.1:8080/api/vault";
const ORIGIN = process.env.ORIGIN || "http://localhost:8080";
const DEV_LOG = process.env.DEV_LOG;
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = "GET", body, raw, headers = {}, cookie, origin = ORIGIN } = {}) {
  const h = Object.assign({ Accept: "application/json" }, headers);
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (origin && method !== "GET") h.Origin = origin;
  const r = await fetch(BASE + path, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null;
  try { data = JSON.parse(buf.toString("utf8")); } catch (e) {}
  return { status: r.status, data, buf, headers: r.headers };
}
async function linkFor(email, after) {
  for (let i = 0; i < 40; i++) {
    const log = fs.readFileSync(DEV_LOG).subarray(after).toString("utf8");
    const m = [...log.matchAll(new RegExp("\\[dev mail\\] to=" + email.replace(/[.+]/g, "\\$&") + "[\\s\\S]*?#t=([A-Za-z0-9_-]+)", "g"))];
    if (m.length) return m.at(-1)[1];
    await sleep(150);
  }
  return null;
}
function sql(command) {
  for (let i = 0; i < 3; i++) {
    try {
      const out = execFileSync(process.env.WRANGLER || "wrangler", ["d1", "execute", "brain-vault-db", "--local", "--persist-to", process.env.PERSIST || ".wrangler/state", "--json", "--command", command], { encoding: "utf8", cwd: process.env.WORKER_DIR || process.cwd() });
      return JSON.parse(out)[0].results;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ADMIN = "sf_sid=admin";
const PUBLIC_USER = "sf_sid=user";
const platforms = read("../../../assets/growth/platforms.json");
const prompt = read("../../../assets/growth/visuals.prompt.json");

/* A PNG whose header says width x height (enough for the type and size checks). */
function png(w, h, extra = 0) {
  const b = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return extra ? Buffer.concat([b, Buffer.alloc(extra, 7)]) : b;
}
const JPG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffc0000b080546043801011100ffd9", "hex");

function campaign(id, extra = {}) {
  const m = read("./fixtures/pilot-campaign-model.json");
  m.socialCopy = m.socialCopy.map((p) => (p.channel === "google_business" ? Object.assign(p, { hashtags: [] }) : p));
  return Object.assign({ schemaVersion: "campaign-1", clientId: id, campaignId: "cp_2026_10_en", brainVersion: 1, name: "A Little Extra", month: "2026-10", goal: "sales", language: "en", channels: ["instagram", "facebook", "google_business"], status: "in_production" }, m, extra);
}
function pack(doc, photoIds) {
  const slots = buildSlots(doc, platforms);
  const raw = { visuals: slots.map((s) => {
    const product = /offer|social|gbp|video_cover/.test(s.id);
    return {
      id: s.id,
      subject: product ? "product" : "mood",
      source: product ? "client_photo" : "ai_image",
      photo_ref: product ? photoIds[0] : null,
      cast: "",
      prompt: product ? "Crop the client's photo, warm the light, extend the table so the top fifth stays empty." : "Warm evening light over a wooden table in Buea, accents of #F0B84C, top fifth calm and empty. " + prompt.noTextSentence,
      avoid: "text, logos",
      overlay: { headline: "A little extra", sub: "Free protein bites with two mains", cta: "Order now" },
      alt_text: { sv: "En tallrik mat.", en: "A plate of food." }
    };
  }) };
  const out = normalizeVisuals(raw, slots, { photoIds, language: doc.language, noTextSentence: prompt.noTextSentence, avoidDefault: prompt.avoidDefault });
  return withVisuals(doc, out.visuals);
}

try {
  const email = "vis-" + run + "@example.com";
  const mark = fs.statSync(DEV_LOG).size;
  let r = await call("/admin/clients", { method: "POST", cookie: ADMIN, body: { name: "Visual Test Kitchen", email, language: "en" } });
  const id = r.data.client.id;
  r = await call("/auth/verify", { method: "POST", body: { t: await linkFor(email, mark) } });
  const client = (r.headers.getSetCookie().find((x) => x.startsWith("__Host-tv_session=")) || "").split(";")[0];
  await call("/consent", { method: "POST", cookie: client, body: { accepted: true, language: "en" } });
  const pics = [];
  for (const n of ["plantains.png", "protein-bites.png"]) {
    r = await call("/uploads?section=pictures", { method: "POST", cookie: client, raw: png(1080, 1350), headers: { "Content-Type": "image/png", "X-File-Name": encodeURIComponent(n) } });
    pics.push(r.data.file.id);
  }
  ok(pics.length === 2 && pics.every(Boolean), "the client uploaded two dish photos");
  const fixture = read("./fixtures/pilot-intake-v1.json");
  await call("/intake", { method: "PUT", cookie: client, body: { answerLanguage: "en", campaignLanguage: "en", profile: fixture.profile, uploads: { pictures: pics.map((p, i) => ({ fileId: p, name: "dish" + i + ".png", mime: "image/png" })), founderStory: { text: "Story.", fileId: null }, previousPosts: [], faqs: { rows: [], fileId: null } } } });
  await call("/intake/submit", { method: "POST", cookie: client, body: {} });
  const brain = Object.assign(read("./fixtures/pilot-brain-v1.json"), { builtFromIntakeVersion: 1, editedByHarry: false });
  r = await call("/admin/brain/" + id, { method: "POST", cookie: ADMIN, body: { brain } });
  ok(r.status === 201, "brain v1 saved");

  /* An old campaign-1 campaign still saves and opens as campaign-1. */
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: campaign(id) } });
  ok(r.status === 201 && r.data.campaign.schemaVersion === "campaign-1" && !r.data.campaign.visuals, "a campaign without visuals is saved as campaign-1");
  r = await call("/admin/campaign/" + id + "/cp_2026_10_en", { cookie: ADMIN });
  ok(r.status === 200 && r.data.campaign.schemaVersion === "campaign-1", "the campaign-1 campaign opens");
  r = await call("/admin/delivery/" + id + "/cp_2026_10_en?ai=1&visual=v_offer", { method: "POST", cookie: ADMIN, raw: png(1080, 1080), headers: { "Content-Type": "image/png", "X-File-Name": "offer.png" } });
  ok(r.status === 400 && r.data.error === "visual", "an image cannot be tied to a brief the campaign does not have");

  /* Add visuals: the same campaign saved again with a Visual Pack becomes campaign-2. */
  const withPack = pack(campaign(id), pics);
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: Object.assign({}, withPack, { schemaVersion: "campaign-1" }) } });
  ok(r.status === 200 && r.data.campaign.schemaVersion === "campaign-2" && r.data.campaign.visuals.length === withPack.visuals.length, "Add visuals turns it into a campaign-2 document");
  const saved = r.data.campaign;
  ok(saved.visuals.filter((v) => v.subject === "product").every((v) => v.source === "client_photo" && v.photo_ref === pics[0]), "dish shots use the client's own photo");
  ok(saved.visuals.every((v) => v.width && v.height && v.clear_zone), "every brief has a size and a clear zone");
  r = await call("/admin/campaigns/" + id, { cookie: ADMIN });
  ok(r.data.campaigns.length === 1, "still one campaign, now with visuals");
  const broken = JSON.parse(JSON.stringify(withPack));
  broken.visuals[0].platform = "myspace";
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: broken } });
  ok(r.status === 400 && r.data.details.some((x) => /platform/.test(x)), "a brief with an unknown platform is refused");
  const dashed = JSON.parse(JSON.stringify(withPack));
  dashed.visuals[0].overlay.headline = "A little \u2014 extra";
  r = await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: dashed } });
  ok(r.status === 200 && r.data.campaign.visuals[0].overlay.headline === "A little, extra", "em-dashes in briefs are replaced on save");
  await call("/admin/campaign/" + id, { method: "POST", cookie: ADMIN, body: { campaign: withPack } });

  /* Brand kit */
  r = await call("/admin/brandkit/" + id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.kit === null, "no brand kit yet");
  r = await call("/admin/brandkit/" + id, { method: "PUT", cookie: ADMIN, body: { kit: { name: "Chef Sandy's Kitchen", colors: [{ role: "accent", hex: "gold" }] } } });
  ok(r.status === 400 && r.data.error === "kit", "a kit without a valid hex colour is refused");
  const kit = { name: "Chef Sandy's Kitchen", slug: "chef-sandys-kitchen", colors: [{ role: "light", hex: "#fff6e6" }, { role: "accent", hex: "#F0B84C" }, { role: "pill", hex: "#7A1E1E" }, { role: "scrim", hex: "#120804" }], fonts: ["Poppins Bold", "Lora Italic"], logoNotes: "Gold on transparent.", source: "BRAND-KITS/chef-sandys-kitchen/brand.json" };
  r = await call("/admin/brandkit/" + id, { method: "PUT", cookie: client, body: { kit } });
  ok(r.status === 403, "a client cannot change the brand kit");
  r = await call("/admin/brandkit/" + id, { method: "PUT", cookie: ADMIN, body: { kit }, origin: "https://evil.example" });
  ok(r.status === 403, "a brand kit sent from another site is refused");
  r = await call("/admin/brandkit/" + id, { method: "PUT", cookie: ADMIN, body: { kit } });
  ok(r.status === 200 && r.data.kit.colors[0].hex === "#FFF6E6" && /overlay layer/.test(r.data.kit.logoPlacement), "brand kit saved, colours tidied, logo placement defaulted");
  r = await call("/admin/brandkit/" + id, { cookie: ADMIN });
  ok(r.data.kit && r.data.kit.colors.length === 4 && r.data.kit.fonts.length === 2, "the brand kit reads back");

  /* Finished images */
  const D = "/admin/delivery/" + id + "/cp_2026_10_en";
  const vOffer = saved.visuals.find((v) => v.output_key === "offer");
  const vHero = saved.visuals.find((v) => v.output_key === "landingPage.hero");
  const vIg = saved.visuals.find((v) => v.output_key === "socialCopy.instagram");
  const up = (q, bytes, name, opts = {}) => call(D + q, Object.assign({ method: "POST", cookie: ADMIN, raw: bytes, headers: { "Content-Type": "image/png", "X-File-Name": encodeURIComponent(name) } }, opts));
  r = await up("?visual=" + vOffer.id, png(1080, 1080), "offer.png");
  ok(r.status === 400, "the AI flag is required");
  r = await up("?ai=1&visual=" + vOffer.id, Buffer.from("GIF89a"), "offer.gif");
  ok(r.status === 415, "only JPG, PNG or WebP");
  r = await up("?ai=1&visual=" + vOffer.id, Buffer.from("not a png at all"), "offer.png");
  ok(r.status === 415 && r.data.error === "content", "a renamed file is refused");
  r = await up("?ai=1&visual=" + vOffer.id, png(1080, 1080), "offer.png", { cookie: client });
  ok(r.status === 403, "a client cannot attach images");
  r = await up("?ai=1&visual=" + vOffer.id, png(1080, 1080), "offer.png", { cookie: PUBLIC_USER });
  ok(r.status === 403 || r.status === 401, "a public ScriptForge user cannot attach images");
  r = await up("?ai=1&visual=" + vOffer.id, png(1080, 1080), "offer.png", { origin: "https://evil.example" });
  ok(r.status === 403, "an upload from another site is refused");

  r = await up("?ai=1&visual=" + vOffer.id + "&title=" + encodeURIComponent(vOffer.placement), png(1080, 1080), "offer-final.png");
  ok(r.status === 201 && r.data.delivery.aiImage === true && r.data.delivery.width === 1080 && r.data.delivery.height === 1080, "AI offer graphic attached, size read from the file");
  const first = r.data.delivery;
  r = await up("?ai=1&visual=" + vHero.id, png(1920, 1080), "hero.png");
  ok(r.status === 201 && r.data.delivery.visualId === vHero.id, "AI landing hero attached");
  r = await call(D + "?ai=0&visual=" + vIg.id, { method: "POST", cookie: ADMIN, raw: JPG, headers: { "Content-Type": "image/jpeg", "X-File-Name": "plantains-final.jpg" } });
  ok(r.status === 201 && r.data.delivery.aiImage === false && r.data.delivery.width === 1080 && r.data.delivery.height === 1350, "edited client photo attached as a real photo (JPEG size read)");

  r = await call(D, { cookie: ADMIN });
  ok(r.status === 200 && r.data.deliveries.length === 3, "three finished images are listed");
  ok(r.data.deliveries.filter((d) => d.aiImage).length === 2 && r.data.deliveries.every((d) => d.url.startsWith("/api/vault/admin/delivery/" + id + "/")), "each carries its AI flag and a link");
  r = await call(D, { cookie: client });
  ok(r.status === 403, "clients do not see the list yet (that is Part B)");
  r = await call(D, { cookie: PUBLIC_USER });
  ok(r.status === 403 || r.status === 401, "a public ScriptForge user sees nothing");
  r = await call(D + "/" + first.id, { cookie: ADMIN });
  ok(r.status === 200 && r.headers.get("content-type") === "image/png" && r.buf.equals(png(1080, 1080)), "the image itself downloads unchanged");
  const keys = sql("SELECT r2_key FROM deliveries WHERE client_id = '" + id + "'");
  ok(keys.length === 3 && keys.every((k) => k.r2_key.startsWith("c/" + id + "/d_")), "images are stored in R2 under the client's folder with random names");
  r = await call(D + "/" + first.id, { method: "DELETE", cookie: ADMIN });
  ok(r.status === 200, "a wrong image can be removed");
  r = await call(D + "/" + first.id, { cookie: ADMIN });
  ok(r.status === 404, "the removed image is gone");
  r = await up("?ai=1&visual=" + vOffer.id, png(1080, 1080), "offer-final-2.png");
  ok(r.status === 201, "and attached again");

  /* Keys never reach the Vault */
  r = await call("/admin/brandkit/" + id, { method: "PUT", cookie: ADMIN, body: { kit: Object.assign({}, kit, { logoNotes: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }) } });
  ok(r.status === 400 && r.data.error === "api_key", "a brand kit holding something like an API key is refused");

  /* Export and erasure cover the new data */
  r = await call("/admin/export/" + id, { cookie: ADMIN });
  ok(r.status === 200 && r.data.deliveries.length === 3 && r.data.brandKit && r.data.brandKit.kit.name === "Chef Sandy's Kitchen" && r.data.campaigns[0].data.schemaVersion === "campaign-2", "the export includes finished images, the brand kit and the Visual Pack");
  r = await call("/admin/clients/" + id, { method: "DELETE", cookie: ADMIN, body: { confirm: email } });
  ok(r.status === 200 && r.data.remaining.rows === 0 && r.data.remaining.files === 0, "erasure leaves nothing behind");
  const left = sql("SELECT (SELECT COUNT(*) FROM deliveries WHERE client_id = '" + id + "') AS d, (SELECT COUNT(*) FROM brand_kits WHERE client_id = '" + id + "') AS k");
  ok(left[0].d === 0 && left[0].k === 0, "no finished images or brand kit rows remain");

  r = await call("/health");
  ok(r.data.phase === 6 && /^[a-z0-9]+$/.test(r.data.part), "health reports phase 6 and the V2 part");
} catch (e) {
  fail++;
  console.log("FAIL crashed: " + e.stack);
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
