/* V2 Parts A and B: what the client sees of a campaign.

   clientView() turns a saved campaign into plain cards in the campaign language: the idea,
   opening lines, the offer, the video script, each social post, the ads, the calls to action,
   the landing page text, the email and the Google Business post. No AI terms, no brain, no
   image prompts. Each card's copy text carries its tracked short link and offer code once the
   landing page has them, so the client can paste it straight into the post. */
import { noDashes } from "./util.js";

const CH = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", google_business: "Google Business", email: "E-post / Email", whatsapp: "WhatsApp" };
const T = (sv, en) => ({ sv, en });

function linkKey(cardKey) {
  if (cardKey.startsWith("socialCopy.")) {
    const ch = cardKey.slice(11);
    return ch === "email" ? "email.body" : "post." + (ch === "google_business" ? "google" : ch);
  }
  const m = /^adVariations\.(\d+)$/.exec(cardKey);
  if (m) return "ad." + m[1];
  if (cardKey === "email") return "email.body";
  if (cardKey === "googleBusinessPost") return "post.google";
  if (cardKey === "shortVideo") return "video.voice";
  return null;
}

const lines = (arr) => arr.filter((x) => x != null && String(x).trim() !== "").join("\n\n");

/* links: rows from the links table ({code, output_key, offer_code}); origin: the site. */
export function clientView(doc, { links = [], origin = "", pageUrl = "" } = {}) {
  const lang = doc.language === "en" ? "en" : "sv";
  const byKey = {};
  links.forEach((l) => { byKey[l.output_key] = l; });
  const cards = [];
  const add = (key, title, text) => {
    if (!text || !String(text).trim()) return;
    const card = { key, title, text: noDashes(String(text).trim()) };
    const lk = linkKey(key);
    const l = lk && byKey[lk];
    if (l) {
      card.link = origin + "/go/r/" + l.code;
      card.offerCode = l.offer_code || "";
      const codeLine = card.offerCode ? (lang === "en" ? "Use the code " + card.offerCode + " when you order." : "Ange koden " + card.offerCode + " när du beställer.") : "";
      card.copyText = noDashes(card.text + "\n\n" + (codeLine ? codeLine + "\n" : "") + card.link);
    } else card.copyText = card.text;
    cards.push(card);
  };
  const c = doc.concept;
  if (c) add("concept", T("Idén", "The idea"), lines([c.title, c.bigIdea, c.keyMessage]));
  if (Array.isArray(doc.hook) && doc.hook.length) add("hook", T("Öppningsrader för video", "Opening lines for video"), doc.hook.map((x, i) => (i + 1) + ". " + x).join("\n"));
  const o = doc.offer;
  if (o) add("offer", T("Erbjudandet", "The offer"), lines([o.framing, o.terms, o.deadline, o.riskReversal]));
  if (doc.shortVideo) add("shortVideo", T("Videomanus (30 sekunder)", "Video script (30 seconds)"), doc.shortVideo.script);
  (doc.socialCopy || []).forEach((p) => {
    const tags = (p.hashtags || []).map((x) => (String(x).startsWith("#") ? x : "#" + x)).join(" ");
    add("socialCopy." + p.channel, T("Inlägg: " + (CH[p.channel] || p.channel), "Post: " + (CH[p.channel] || p.channel)), lines([p.text, tags]));
  });
  (doc.adVariations || []).forEach((a, i) => add("adVariations." + (i + 1), T("Annons " + (i + 1), "Ad " + (i + 1)), lines([a.headline, a.primaryText, a.description])));
  if (Array.isArray(doc.cta) && doc.cta.length) add("cta", T("Uppmaningar", "Calls to action"), doc.cta.map((x) => x.text + " [" + x.button + "]").join("\n"));
  const lp = doc.landingPage;
  if (lp) add("landingPage", T("Kampanjsidan", "Campaign page"), lines([lp.headline, lp.subheadline, (lp.benefits || []).map((b) => b.title + ": " + b.text).join("\n"), lp.cta, pageUrl]));
  const e = doc.email;
  if (e) add("email", T("E-postutskick", "Email"), lines([(lang === "en" ? "Subject: " : "Ämnesrad: ") + (e.subjects || [])[0], e.preview, e.body, e.cta]));
  if (doc.googleBusinessPost) add("googleBusinessPost", T("Google Business-inlägg", "Google Business post"), doc.googleBusinessPost.text);
  return { campaignId: doc.campaignId, name: doc.name || "", month: doc.month || "", language: lang, cards };
}
