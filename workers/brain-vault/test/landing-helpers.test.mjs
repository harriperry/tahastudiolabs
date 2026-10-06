/* V2 phase G2b test: the landing page builder (assets/growth-landing.js) and its template.
   Plain node, no Worker needed:
     node test/landing-helpers.test.mjs */
import fs from "node:fs";
import {
  availableActions,
  campaignText,
  codePrefix,
  contrast,
  embedCode,
  guideHtml,
  linkPlan,
  linkUrl,
  pageModel,
  pickColors,
  privacyNotice,
  qrMatrix,
  qrSvg,
  renderPage,
  textWithLink
} from "../../../assets/growth-landing.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("PASS " + n); } else { fail++; console.log("FAIL " + n); } };
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), "utf8"));
const template = fs.readFileSync(new URL("../../../assets/growth/landing.template.html", import.meta.url), "utf8");

const model = read("./fixtures/pilot-campaign-model.json");
const doc = Object.assign({ schemaVersion: "campaign-1", clientId: "cl_test", campaignId: "cp_2026_10_en", brainVersion: 1, name: "A Little Extra", month: "2026-10", goal: "sales", language: "en", channels: ["instagram", "facebook", "tiktok", "google_business"], status: "in_production" }, model);
const settings = { companyName: "Chef Sandy's Kitchen", phone: "+237670000000", whatsapp: "237670000000", whatsappText: "Hi Sandy", address: "Molyko, Buea", hours: "Every day 8 to 22", email: "", bookingUrl: "", orderUrl: "", mapUrl: "", orgNumber: "", primary: "whatsapp", gallery: [], reviews: ["Best ndole in Buea!"], countVisits: false };
const page = { id: "pg_abcd1234", url: "https://tahastudiolabs.com/go/chef-sandys-kitchen/a-little-extra", offerEnd: "2026-10-31", formOn: true, token: "tok_123", settings };
const kit = { colors: [{ role: "primary", hex: "#7A1F1F" }, { role: "accent", hex: "#F2B705" }, { role: "background", hex: "#FFF8EC" }], fonts: ["Playfair Display", "Inter"] };
const images = { hero: { src: "/go/a/pg_abcd1234/hero-800.webp", srcset: [{ url: "/go/a/pg_abcd1234/hero-800.webp", w: 800 }, { url: "/go/a/pg_abcd1234/hero-1600.webp", w: 1600 }], width: 1600, height: 900 }, heroAlt: "Two plates of ndole", ogAbsolute: "https://tahastudiolabs.com/go/a/pg_abcd1234/og.jpg", gallery: [{ img: { src: "/go/a/pg_abcd1234/g1-600.webp", srcset: [{ url: "/go/a/pg_abcd1234/g1-600.webp", w: 600 }], width: 600, height: 600 }, alt: "Fried plantains" }] };

/* campaignText: the one place Part H plugs in */
const text = campaignText(doc);
ok(text.headline === doc.landingPage.headline && text.benefits.length === 3 && text.language === "en", "campaignText reads the landing page text");
const approved = campaignText(Object.assign({}, doc, { language: "sv" }), { approved: { "landingPage.headline": "Godkänd rubrik", "landingPage.benefits.1.title": "Granskad" } });
ok(approved.headline === "Godkänd rubrik" && approved.benefits[1].title === "Granskad" && approved.benefits[0].title === doc.landingPage.benefits[0].title, "approved text (Part H) replaces only the fields it names");

/* Offer codes and the link plan */
ok(codePrefix("Chef Sandy's Kitchen") === "SANDY", "offer code prefix from the company name: SANDY");
ok(codePrefix("Salong Mira") === "MIRA" && codePrefix("Café Ängen") === "ANGEN", "generic words are skipped, letters kept plain");
const plan = linkPlan(doc, "SANDY", settings);
const keys = plan.map((l) => l.outputKey);
ok(keys.includes("post.instagram") && keys.includes("post.google") && keys.includes("bio.instagram") && keys.includes("ad.5") && keys.includes("qr.flyer") && keys.includes("qr.counter") && keys.includes("video.voice"), "one tracked link per output, bio, print and the video");
ok(plan.find((l) => l.outputKey === "post.instagram").offerCode === "SANDY-IG" && plan.find((l) => l.outputKey === "qr.flyer").offerCode === "SANDY-QR" && plan.find((l) => l.outputKey === "post.tiktok").offerCode === "SANDY-TT", "each channel has its own offer code (SANDY-IG, SANDY-TT, SANDY-QR)");
ok(keys.includes("button.whatsapp") && keys.includes("button.call") && keys.includes("button.directions") && !keys.includes("button.booking"), "downloaded page buttons get tracked links only for actions that exist");
ok(JSON.stringify(linkPlan(doc, "SANDY", settings)) === JSON.stringify(plan), "the same campaign gives the same plan");
const link = { code: "ab12cd3", channel: "instagram", medium: "social", outputKey: "post.instagram", url: "https://tahastudiolabs.com/go/r/ab12cd3", offerCode: "SANDY-IG" };
const full = linkUrl(link, page, "cp_2026_10_en");
ok(full.startsWith(page.url + "?") && /utm_source=instagram/.test(full) && /utm_medium=social/.test(full) && /utm_campaign=2026_10_en/.test(full) && /utm_content=post.instagram/.test(full) && /c=ab12cd3/.test(full), "online links carry utm_source, utm_medium, utm_campaign, utm_content and the code");
ok(linkUrl(Object.assign({}, link, { medium: "print" }), page, "cp_x") === link.url, "print, video and bio links stay short");
const withLink = textWithLink(text, "post.instagram", full, "SANDY-IG", "en");
ok(withLink.includes(doc.socialCopy.find((p) => p.channel === "instagram").text.slice(0, 20)) && withLink.includes("SANDY-IG") && withLink.endsWith(full), "Copy text with link adds the code and the link to the post");

/* Colours */
const c = pickColors(kit);
ok(c.brand === "#7A1F1F" && c.accent === "#F2B705", "brand and accent come from the kit roles");
ok(contrast(c.brand, c.onBrand) >= 4.5 && contrast(c.accent, c.onAccent) >= 4.5, "text on brand and accent colours is readable (4.5:1 or more)");
ok(pickColors(null).brand && pickColors({ colors: [{ role: "primary", hex: "#FFFFFF" }] }).brand !== "#FFFFFF", "no kit or a white primary still gives a usable brand colour");

/* The hosted page */
const m = pageModel({ doc, text, profile: { companyName: "Chef Sandy's Kitchen" }, kit, page, images, origin: "https://tahastudiolabs.com", tahaEmail: "agborkak@gmail.com", mode: "hosted", links: [] });
const html = renderPage(template, m);
ok(/^<!doctype html>/i.test(html) && /<html lang="en">/.test(html), "the page has the campaign language in its lang attribute");
ok(!/\u2014/.test(html), "no em-dashes anywhere in the page");
ok(!/\{\{[A-Z_]+\}\}/.test(html), "every template token is filled");
const scripts = html.match(/<script[^>]*>/gi) || [];
ok(scripts.length === 1 && /application\/ld\+json/.test(scripts[0]), "the stored page has no script but its LocalBusiness JSON-LD (the Worker adds the counter)");
ok(!/\s(src|srcset)=["']\s*(https?:)?\/\//i.test(html) && !/<link[^>]+stylesheet/i.test(html) && !/fonts\.googleapis|@import/i.test(html), "no third-party requests: images local, CSS inline, no web fonts");
ok(/"@type":"LocalBusiness"/.test(html) && /"telephone":"\+237670000000"/.test(html) && /"validThrough":"2026-10-31"/.test(html), "LocalBusiness JSON-LD from the brain and page details");
ok(/og:image" content="https:\/\/tahastudiolabs.com\/go\/a\/pg_abcd1234\/og.jpg"/.test(html) && /<title>[^<]+<\/title>/.test(html) && /name="description"/.test(html), "title, description and Open Graph image for sharing");
ok(/class="hero-img"[^>]+srcset="[^"]*800w, [^"]*1600w"/.test(html), "the hero image comes in two widths");
ok(html.indexOf("hero") < html.indexOf("offer-h") && html.indexOf("offer-h") < html.indexOf(">Why customers choose us<") && html.indexOf("Why customers choose us") < html.indexOf("Take a look") && html.indexOf("Take a look") < html.indexOf("What our customers say") && html.indexOf("What our customers say") < html.indexOf("How to get it") && html.indexOf("How to get it") < html.indexOf('id="enquiry"') && html.indexOf('id="enquiry"') < html.indexOf("<footer"), "sections in spec order: hero, offer, reasons, gallery, reviews, how to get it, form, footer");
ok(/Valid until 31 October 2026/.test(html), "the offer shows its end date");
ok(/Best ndole in Buea!/.test(html) && !/People travel long distances/.test(html), "reviews are only the real ones chosen, never the generator's proof lines");
ok(/href="https:\/\/wa.me\/237670000000\?text=Hi%20Sandy"[^>]*data-t="whatsapp"/.test(html) && /href="tel:\+237670000000"[^>]*data-t="call"/.test(html), "buttons go to WhatsApp and the phone and are tracked by type");
ok(/<a class="btn btn-main" href="https:\/\/wa.me[^"]*"[^>]*>Text to order<\/a>/.test(html), "the main button uses the campaign's CTA and the chosen action");
ok(/<form method="post" action="\/api\/vault\/pub\/lead\/pg_abcd1234" data-lead>/.test(html) && /name="website"/.test(html) && !/name="token"/.test(html), "the hosted form posts to the Vault with a honeypot and no token");
ok(/id="sent"/.test(html) && /#sent:target/.test(html), "the thank-you message shows after the form, without script");
ok(/Page by TAHA Studio Labs/.test(html) && /<details id="privacy">/.test(html), "footer with the privacy notice and Page by TAHA Studio Labs");
ok(/class="bar"/.test(html), "a sticky action bar on phones");

/* Privacy notice */
const notice = privacyNotice(m).join(" ");
ok(/Controller: Chef Sandy's Kitchen/.test(notice) && /Processor: TAHA Studio Labs/.test(notice) && /90 days after the offer ends \(31 October 2026\)/.test(notice) && /IMY/.test(notice) && /without cookies/.test(notice), "the notice names the client as controller and TAHA as processor, retention, rights and IMY");
const sv = privacyNotice(Object.assign({}, m, { lang: "sv", offerEndText: "31 oktober 2026" })).join(" ");
ok(/Personuppgiftsansvarig: Chef Sandy's Kitchen/.test(sv) && /Personuppgiftsbiträde: TAHA Studio Labs/.test(sv) && /Integritetsskyddsmyndigheten/.test(sv), "the Swedish notice says the same");
const noForm = privacyNotice(Object.assign({}, m, { formOn: false })).join(" ");
ok(!/enquiry/i.test(noForm) && /without cookies/.test(noForm), "without the form the notice only covers counting");

/* Escaping: campaign text can never add markup or fill a token */
const evil = Object.assign({}, text, { headline: '<script>alert(1)</script>{{MAIN}}', subheadline: 'Sub "quoted" \u2014 dash' });
const evilHtml = renderPage(template, Object.assign({}, m, { text: evil }));
ok(!/<script>alert/.test(evilHtml) && /&lt;script&gt;/.test(evilHtml) && /\{\{MAIN\}\}/.test(evilHtml) && !/\u2014/.test(evilHtml), "text is escaped, a token in the text stays text, and dashes are removed");

/* The ended message */
const ended = renderPage(template, m, { ended: true });
ok(/This offer has ended/.test(ended) && /31 October 2026/.test(ended) && /noindex/.test(ended) && !/id="enquiry"/.test(ended) && /class="ended"/.test(ended), "the ended version says so, keeps the contact details, drops the form and is not indexed");
ok(/data-t="whatsapp"/.test(ended), "the ended version still lets people get in touch");

/* The downloaded copy */
const links = plan.map((l, i) => Object.assign({ code: "code" + i, url: "https://tahastudiolabs.com/go/r/code" + i }, l));
const dm = Object.assign({}, m, { mode: "download", links, images: { hero: "data:image/webp;base64,AAAA", gallery: [] } });
const dl = renderPage(template, dm);
const waLink = links.find((l) => l.outputKey === "button.whatsapp").url;
ok(dl.includes('href="' + waLink + '"') && !/data-t="whatsapp"/.test(dl), "download buttons go through tracked short links and are not counted twice");
ok(/action="https:\/\/tahastudiolabs.com\/api\/vault\/pub\/lead\/pg_abcd1234"/.test(dl) && /name="token" value="tok_123"/.test(dl), "the downloaded form posts to the Vault with the page token");
ok(!/go\/t\.js/.test(dl), "no counter on the download unless Count visits is ticked");
const dl2 = renderPage(template, Object.assign({}, dm, { settings: Object.assign({}, settings, { countVisits: true }) }));
ok(/<script src="https:\/\/tahastudiolabs.com\/go\/t.js" data-p="pg_abcd1234" data-e="https:\/\/tahastudiolabs.com\/api\/vault\/pub\/event" defer><\/script>/.test(dl2), "Count visits adds the cookieless counter with absolute addresses");
ok(/src="data:image\/webp;base64/.test(dl) && /noindex/.test(dl), "the download embeds its images and is not indexed");
ok(Buffer.byteLength(dl) < 3 * 1024 * 1024, "the download stays under 3 MB");

/* Embed, guide, QR */
const emb = embedCode(page.url, 'A "Little" Extra');
ok(/^<iframe src="https:\/\/tahastudiolabs.com\/go\/chef-sandys-kitchen\/a-little-extra"/.test(emb) && /&quot;Little&quot;/.test(emb), "embed code is an iframe of the hosted page");
const guide = guideHtml("Chef Sandy's Kitchen", page.url);
ok(/WordPress/.test(guide) && /Wix/.test(guide) && /Squarespace/.test(guide) && /Lägg sidan på din webbplats/.test(guide) && /Put the page on your website/.test(guide) && !/\u2014/.test(guide), "the guide is bilingual and covers WordPress, Wix and Squarespace");
const mat = qrMatrix("https://tahastudiolabs.com/go/r/ab12cd3");
ok(mat.length >= 21 && mat[0][0] === true && mat[0][6] === true && mat[6][6] === true, "the QR code has its finder patterns");
ok(/^<svg[^>]+viewBox="0 0 \d+ \d+"/.test(qrSvg("https://tahastudiolabs.com/go/r/ab12cd3")), "the QR code downloads as SVG");
ok(availableActions({ phone: "123456", address: "x" }).join() === "call,directions", "available actions follow the contact details");

/* Swedish page */
const svText = campaignText(Object.assign({}, doc, { language: "sv" }));
const svHtml = renderPage(template, pageModel({ doc, text: svText, profile: {}, kit, page, images, origin: "https://tahastudiolabs.com", mode: "hosted", links: [] }));
ok(/<html lang="sv">/.test(svHtml) && /Gäller till och med 31 oktober 2026/.test(svHtml) && /Skicka en förfrågan/.test(svHtml) && /Sida av TAHA Studio Labs/.test(svHtml), "a Swedish campaign gives a Swedish page");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
