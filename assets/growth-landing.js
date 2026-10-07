/* ScriptForge Growth Clients panel: landing pages, tracked links and ROI
   (TAHA Growth Department V2, phase G2b). Loaded by growth-campaign.js, admin only.

   How a page is made (spec 9.2 to 9.4):
   1. Harry fills the Landing page box: the address, how to reach the business (phone,
      WhatsApp, booking or order link, address, hours), the offer's end date, which client
      photos and real reviews to show, and whether the enquiry form is on.
   2. Save stores that in the Brain Vault and creates the tracked links: one per output, one
      per printed QR code, one per page button for the downloaded copy, each with an offer code.
   3. Publish builds the page here, in the browser, from assets/growth/landing.template.html,
      makes the images (WebP in two widths), uploads them, and sends the finished HTML to the
      Vault, which serves it at tahastudiolabs.com/go/<client>/<campaign>.
   No AI runs here, and no API key is involved.

   Every campaign text reaches the page through campaignText(). That is the one place Part H
   (human language review) changes: it will return the approved Swedish text instead. */
import qrcode from "./vendor/qrcode-generator-1.4.4.mjs";
import { authorityLine, currencyLabel, currencyList, formatMoney } from "./growth-markets.js?v=m3";
import { localeOf, pageLanguage } from "./growth-languages.js?v=l2";

export const TEMPLATE_URL = "/assets/growth/landing.template.html?v=g2b";
export const NOTICE_VERSION = "n-1";
const VAULT = "/api/vault";

/* ---------- pure helpers (exported for tests) ---------- */

const noDash = (s) => String(s == null ? "" : s).replace(/\s*\u2014\s*/g, ", ").replace(/\u2013/g, "-");
export function esc(s) {
  return noDash(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const clip = (s, n) => {
  const t = noDash(s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "..." : t;
};

/* The one place a page reads campaign text. Part H will pass {approved} here so Swedish
   fields come from the approved, human reviewed version instead of the machine text. */
export function campaignText(doc, opts = {}) {
  const pick = (path, fallback) => {
    if (opts.approved && Object.prototype.hasOwnProperty.call(opts.approved, path)) return opts.approved[path];
    return fallback;
  };
  const lp = doc.landingPage || {};
  const of = doc.offer || {};
  return {
    language: pageLanguage(doc.language),
    name: doc.name || "",
    headline: pick("landingPage.headline", lp.headline || ""),
    subheadline: pick("landingPage.subheadline", lp.subheadline || ""),
    benefits: (lp.benefits || []).map((b, i) => ({ title: pick("landingPage.benefits." + i + ".title", b.title), text: pick("landingPage.benefits." + i + ".text", b.text) })),
    cta: pick("landingPage.cta", lp.cta || ""),
    offer: {
      framing: pick("offer.framing", of.framing || ""),
      terms: pick("offer.terms", of.terms || ""),
      deadline: pick("offer.deadline", of.deadline || ""),
      riskReversal: pick("offer.riskReversal", of.riskReversal || "")
    },
    socialCopy: (doc.socialCopy || []).map((p) => ({ channel: p.channel, text: pick("socialCopy." + p.channel + ".text", p.text), hashtags: p.hashtags || [] })),
    adVariations: (doc.adVariations || []).map((a, i) => ({ headline: pick("adVariations." + i + ".headline", a.headline), primaryText: pick("adVariations." + i + ".primaryText", a.primaryText), description: pick("adVariations." + i + ".description", a.description) })),
    email: doc.email ? { subject: pick("email.subjects.0", (doc.email.subjects || [])[0] || ""), body: pick("email.body", doc.email.body || ""), cta: pick("email.cta", doc.email.cta || "") } : null,
    googleBusinessPost: doc.googleBusinessPost ? { text: pick("googleBusinessPost.text", doc.googleBusinessPost.text || "") } : null,
    shortVideo: doc.shortVideo ? { script: pick("shortVideo.script", doc.shortVideo.script || "") } : null
  };
}

export const L = {
  sv: {
    offer: "Erbjudandet", ends: "Gäller till och med {date}", reasons: "Därför väljer kunderna oss", gallery: "Hos oss",
    reviews: "Det här säger våra kunder", visit: "Så får du det", hours: "Öppettider", address: "Adress", contact: "Kontakt",
    call: "Ring oss", whatsapp: "Skriv på WhatsApp", booking: "Boka tid", order: "Beställ nu", directions: "Hitta hit", form: "Skicka en förfrågan",
    formTitle: "Skicka en förfrågan", name: "Namn", phone: "Telefon", email: "E-post", message: "Meddelande (frivilligt)",
    oneOf: "Fyll i telefon eller e-post så att vi kan svara dig.", offers: "Ja, jag vill gärna få erbjudanden från {company} framöver.",
    send: "Skicka", purpose: "{company} använder dina uppgifter för att svara på din förfrågan.", sent: "Tack! Din förfrågan har skickats. Vi hör av oss snart.",
    privacy: "Integritet och kakor", by: "Sida av TAHA Studio Labs", endedTitle: "Erbjudandet har slutat",
    endedBody: "Tack för ditt intresse! Det här erbjudandet gällde till och med {date}. Hör av dig till oss så berättar vi vad som gäller just nu.",
    org: "Org.nr", photoAlt: "Bild från {company}"
  },
  en: {
    offer: "The offer", ends: "Valid until {date}", reasons: "Why customers choose us", gallery: "Take a look",
    reviews: "What our customers say", visit: "How to get it", hours: "Opening hours", address: "Address", contact: "Contact",
    call: "Call us", whatsapp: "Message on WhatsApp", booking: "Book now", order: "Order now", directions: "Get directions", form: "Send an enquiry",
    formTitle: "Send an enquiry", name: "Name", phone: "Phone", email: "Email", message: "Message (optional)",
    oneOf: "Fill in a phone number or an email address so we can get back to you.", offers: "Yes, I would like to receive offers from {company}.",
    send: "Send", purpose: "{company} uses your details to answer your enquiry.", sent: "Thank you! Your enquiry has been sent. We will be in touch soon.",
    privacy: "Privacy and cookies", by: "Page by TAHA Studio Labs", endedTitle: "This offer has ended",
    endedBody: "Thank you for your interest! This offer ran until {date}. Get in touch and we will tell you what we have on right now.",
    org: "Org. no.", photoAlt: "Photo from {company}"
  },
  /* Markets step 2: French and Spanish pages. Nigerian and Cameroonian Pidgin pages use the
     English words (pageLanguage in assets/growth-languages.js). */
  fr: {
    offer: "L'offre", ends: "Valable jusqu'au {date}", reasons: "Pourquoi nos clients nous choisissent", gallery: "Chez nous",
    reviews: "Ce que disent nos clients", visit: "Comment en profiter", hours: "Horaires", address: "Adresse", contact: "Contact",
    call: "Appelez-nous", whatsapp: "Écrire sur WhatsApp", booking: "Réserver", order: "Commander", directions: "Itinéraire", form: "Envoyer une demande",
    formTitle: "Envoyer une demande", name: "Nom", phone: "Téléphone", email: "E-mail", message: "Message (facultatif)",
    oneOf: "Indiquez un numéro de téléphone ou une adresse e-mail pour que nous puissions vous répondre.", offers: "Oui, je souhaite recevoir les offres de {company}.",
    send: "Envoyer", purpose: "{company} utilise vos coordonnées pour répondre à votre demande.", sent: "Merci ! Votre demande a bien été envoyée. Nous vous répondrons bientôt.",
    privacy: "Confidentialité et cookies", by: "Page réalisée par TAHA Studio Labs", endedTitle: "Cette offre est terminée",
    endedBody: "Merci de votre intérêt ! Cette offre était valable jusqu'au {date}. Contactez-nous et nous vous dirons ce que nous proposons en ce moment.",
    org: "N° d'entreprise", photoAlt: "Photo de {company}"
  },
  es: {
    offer: "La oferta", ends: "Válida hasta el {date}", reasons: "Por qué nos eligen nuestros clientes", gallery: "Así somos",
    reviews: "Lo que dicen nuestros clientes", visit: "Cómo conseguirlo", hours: "Horario", address: "Dirección", contact: "Contacto",
    call: "Llámanos", whatsapp: "Escríbenos por WhatsApp", booking: "Reservar", order: "Pedir ahora", directions: "Cómo llegar", form: "Enviar una consulta",
    formTitle: "Enviar una consulta", name: "Nombre", phone: "Teléfono", email: "Correo electrónico", message: "Mensaje (opcional)",
    oneOf: "Escribe un teléfono o un correo electrónico para que podamos responderte.", offers: "Sí, quiero recibir ofertas de {company}.",
    send: "Enviar", purpose: "{company} usa tus datos para responder a tu consulta.", sent: "¡Gracias! Tu consulta se ha enviado. Te responderemos pronto.",
    privacy: "Privacidad y cookies", by: "Página creada por TAHA Studio Labs", endedTitle: "Esta oferta ha terminado",
    endedBody: "¡Gracias por tu interés! Esta oferta fue válida hasta el {date}. Escríbenos y te contamos lo que tenemos ahora mismo.",
    org: "N.º de empresa", photoAlt: "Foto de {company}"
  }
};
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));

export function formatDate(iso, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const d = new Date(iso + "T12:00:00Z");
  try {
    return d.toLocaleDateString(localeOf(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  } catch (e) {
    return iso;
  }
}

/* Colours from the brand kit, with text colours that stay readable on them. */
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function onColor(hex) {
  return contrast(hex, "#FFFFFF") >= contrast(hex, "#1D1C1A") ? "#FFFFFF" : "#1D1C1A";
}
export function pickColors(kit) {
  const colors = ((kit && kit.colors) || []).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c.hex));
  const find = (re) => colors.find((c) => re.test(c.role || ""));
  /* Very light colours make a poor hero background; skip them for the brand colour. */
  const usable = colors.filter((c) => lum(c.hex) < 0.7);
  const brand = (find(/primary|brand|main/i) && lum(find(/primary|brand|main/i).hex) < 0.7 ? find(/primary|brand|main/i) : usable[0]) || { hex: "#1F3D2B" };
  const accentC = find(/accent|secondary|highlight|cta/i) || usable.find((c) => c.hex !== brand.hex) || colors.find((c) => c.hex !== brand.hex) || { hex: "#E3A21A" };
  let accent = accentC.hex.toUpperCase();
  if (contrast(accent, brand.hex) < 1.6) accent = onColor(brand.hex) === "#FFFFFF" ? "#FFFFFF" : "#1D1C1A";
  return { brand: brand.hex.toUpperCase(), onBrand: onColor(brand.hex), accent, onAccent: onColor(accent) };
}
export function fontStack(name, fallback) {
  const n = String(name || "").replace(/["'<>;{}\\]/g, "").trim();
  return (n ? '"' + n + '", ' : "") + fallback;
}

/* Offer code prefix from the company name: "Chef Sandy's Kitchen" gives SANDY. */
const GENERIC = /^(the|chef|kitchen|kök|koket|köket|cafe|café|kafe|salong|salon|barber|barbershop|studio|restaurang|restaurant|bar|bistro|ab|hb|och|and|&|of|by|hos|frisör|frisörer|bageri|bakery)$/i;
export function codePrefix(company) {
  const words = String(company || "").split(/\s+/).map((w) => w.replace(/['’]s$/i, "").normalize("NFKD").replace(/[^A-Za-z0-9]/g, "")).filter(Boolean);
  const w = words.find((x) => !GENERIC.test(x)) || words[0] || "TAHA";
  return w.toUpperCase().slice(0, 8);
}
const CODE_SUFFIX = { share: "WEB", instagram: "IG", facebook: "FB", tiktok: "TT", linkedin: "LI", google: "GB", email: "EM", whatsapp: "WA", print: "QR", video: "VID", bio: "BIO" };
export const CHANNEL_LABEL = { share: "Short link (shared anywhere)", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", google: "Google Business", email: "Email", whatsapp: "WhatsApp", print: "Print (QR)", video: "Video", bio: "Profile link", download: "Downloaded page", direct: "Direct or unknown", other: "Other" };

/* Which buttons the page can show, from the contact details Harry filled in. */
export function availableActions(s) {
  const out = [];
  if (s.whatsapp) out.push("whatsapp");
  if (s.phone) out.push("call");
  if (s.bookingUrl) out.push("booking");
  if (s.orderUrl) out.push("order");
  if (s.mapUrl || s.address) out.push("directions");
  return out;
}

export function actionHref(s, type) {
  if (type === "call" && s.phone) return "tel:" + s.phone;
  if (type === "whatsapp" && s.whatsapp) return "https://wa.me/" + s.whatsapp + (s.whatsappText ? "?text=" + encodeURIComponent(s.whatsappText) : "");
  if (type === "booking") return s.bookingUrl || "";
  if (type === "order") return s.orderUrl || "";
  if (type === "directions") return s.mapUrl || (s.address ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s.address) : "");
  if (type === "form") return "#enquiry";
  return "";
}

/* Every tracked link a campaign needs, in a fixed order. Same campaign, same plan. */
export function linkPlan(doc, prefix, settings) {
  const channels = (doc.channels || []).map((c) => (c === "google_business" ? "google" : c));
  const P = prefix || "TAHA";
  const code = (ch) => P + "-" + (CODE_SUFFIX[ch] || "WEB");
  const plan = [];
  const add = (outputKey, channel, medium, label) => plan.push({ outputKey, channel, medium, label, offerCode: medium === "button" ? "" : code(channel) });
  /* The one short link to give out anywhere: WhatsApp, SMS, email signatures, business cards. */
  add("share.main", "share", "share", "Short link to share anywhere");
  channels.forEach((ch) => {
    if (ch === "email") add("email.body", "email", "email", "Email");
    else add("post." + ch, ch, "social", CHANNEL_LABEL[ch] + " post");
  });
  if (channels.includes("instagram")) add("bio.instagram", "instagram", "bio", "Instagram bio link");
  if (channels.includes("tiktok")) add("bio.tiktok", "tiktok", "bio", "TikTok bio link");
  /* Ads run on Meta, TikTok or LinkedIn; a WhatsApp-only campaign's ads (click to WhatsApp) run on Facebook. */
  const adChannel = channels.includes("facebook") ? "facebook" : channels.includes("instagram") ? "instagram" : channels.find((c) => !["whatsapp", "email", "google"].includes(c)) || "facebook";
  (doc.adVariations || []).forEach((a, i) => add("ad." + (i + 1), adChannel, "paid", "Ad variation " + (i + 1)));
  if (doc.shortVideo) add("video.voice", "video", "video", "Short link read aloud in the video");
  add("qr.flyer", "print", "print", "QR code on flyers");
  add("qr.counter", "print", "print", "QR code at the counter");
  availableActions(settings || {}).forEach((t) => add("button." + t, "download", "button", "Downloaded page: " + t + " button"));
  return plan;
}

/* The link to give each output: short for print, video and bios, the full UTM link online. */
export function linkUrl(link, page, campaignId) {
  if (["print", "video", "bio", "button", "share"].includes(link.medium)) return link.url;
  const q = new URLSearchParams({ utm_source: link.channel, utm_medium: link.medium, utm_campaign: String(campaignId || "").replace(/^cp_/, ""), utm_content: link.outputKey, c: link.code });
  return page.url + "?" + q.toString();
}

const OFFER_CODE = {
  sv: "Ange koden {code} när du beställer.",
  en: "Use the code {code} when you order.",
  fr: "Indiquez le code {code} lors de votre commande.",
  es: "Usa el código {code} al hacer tu pedido."
};

/* The copy of one output with its tracked link (and offer code) added at the end. */
export function textWithLink(text, outputKey, url, offerCode, lang) {
  const t = campaignTextFor(text, outputKey);
  if (!t) return "";
  const code = offerCode ? fill(OFFER_CODE[lang] || OFFER_CODE.en, { code: offerCode }) : "";
  return noDash(t.trim() + "\n\n" + (code ? code + "\n" : "") + url);
}
function campaignTextFor(text, key) {
  if (key.startsWith("post.")) {
    const ch = key.slice(5) === "google" ? "google_business" : key.slice(5);
    if (ch === "google_business" && text.googleBusinessPost) return text.googleBusinessPost.text;
    const p = text.socialCopy.find((x) => x.channel === ch);
    return p ? p.text + (p.hashtags && p.hashtags.length ? "\n\n" + p.hashtags.map((x) => (x.startsWith("#") ? x : "#" + x)).join(" ") : "") : "";
  }
  if (key === "email.body") return text.email ? text.email.body : "";
  const m = /^ad\.(\d+)$/.exec(key);
  if (m) {
    const a = text.adVariations[Number(m[1]) - 1];
    return a ? a.headline + "\n\n" + a.primaryText : "";
  }
  return "";
}

/* Privacy notice per page: the client is the controller, TAHA the processor (spec 9.5).
   Markets step 3: the last line names the data protection authority of the client's market. */
export function privacyNotice(m) {
  const co = m.company;
  const contact = [m.settings.email, m.settings.phone].filter(Boolean).join(", ") || co;
  const end = m.offerEndText;
  if (m.lang === "fr") {
    return [
      "Responsable du traitement : " + co + (m.settings.orgNumber ? " (n° " + m.settings.orgNumber + ")" : "") + ". Contact : " + contact + ".",
      "Sous-traitant : TAHA Studio Labs, Örebro, Suède, gère cette page pour le compte de " + co + ". Contact : " + m.tahaEmail + ".",
      m.formOn ? "Si vous envoyez une demande, nous conservons votre nom, votre numéro de téléphone ou votre adresse e-mail et votre message afin que " + co + " puisse vous répondre. La base légale est l'intérêt légitime de " + co + " à répondre à votre demande. " + co + " ne vous enverra des offres que si vous cochez la case, sur la base de votre consentement, que vous pouvez retirer à tout moment." : null,
      m.formOn ? "Les demandes sont conservées dans l'UE chez Cloudflare et supprimées 90 jours après la fin de l'offre" + (end ? " (" + end + ")" : "") + "." : null,
      "Les visites sont comptées sans cookies. Votre adresse IP n'est pas conservée ; une valeur aléatoire qui change chaque jour sert uniquement à compter les visiteurs uniques. Les données de visite sont supprimées après 90 jours.",
      "Vous avez le droit de savoir quelles informations nous détenons sur vous, de les faire corriger ou supprimer et de vous y opposer. Contactez " + co + ". " + authorityLine(m.market, "fr")
    ].filter(Boolean);
  }
  if (m.lang === "es") {
    return [
      "Responsable del tratamiento: " + co + (m.settings.orgNumber ? " (n.º " + m.settings.orgNumber + ")" : "") + ". Contacto: " + contact + ".",
      "Encargado del tratamiento: TAHA Studio Labs, Örebro, Suecia, gestiona esta página por cuenta de " + co + ". Contacto: " + m.tahaEmail + ".",
      m.formOn ? "Si envías una consulta, guardamos tu nombre, tu teléfono o tu correo electrónico y tu mensaje para que " + co + " pueda responderte. La base legal es el interés legítimo de " + co + " en responder a tu consulta. " + co + " solo te enviará ofertas si marcas la casilla, con tu consentimiento como base, y puedes retirarlo cuando quieras." : null,
      m.formOn ? "Las consultas se guardan en la UE con Cloudflare y se borran 90 días después de que termine la oferta" + (end ? " (" + end + ")" : "") + "." : null,
      "Las visitas se cuentan sin cookies. Tu dirección IP no se guarda; un valor aleatorio que cambia cada día se usa solo para contar visitantes únicos. Los datos de visitas se borran a los 90 días.",
      "Tienes derecho a saber qué datos tenemos sobre ti, a que se corrijan o se borren y a oponerte. Contacta con " + co + ". " + authorityLine(m.market, "es")
    ].filter(Boolean);
  }
  if (m.lang === "en") {
    return [
      "Controller: " + co + (m.settings.orgNumber ? " (org. no. " + m.settings.orgNumber + ")" : "") + ". Contact: " + contact + ".",
      "Processor: TAHA Studio Labs, Örebro, Sweden, runs this page on behalf of " + co + ". Contact: " + m.tahaEmail + ".",
      m.formOn ? "If you send an enquiry, we store your name, your phone number or email address and your message so that " + co + " can answer you. The legal basis is " + co + "'s legitimate interest in answering your enquiry. Only if you tick the box will " + co + " also send you offers, based on your consent, which you can withdraw at any time." : null,
      m.formOn ? "Enquiries are stored in the EU with Cloudflare and deleted 90 days after the offer ends" + (end ? " (" + end + ")" : "") + "." : null,
      "Visits are counted without cookies. Your IP address is not stored; a random value that changes every day is used only to count unique visitors. Counting data is deleted after 90 days.",
      "You have the right to know what information we hold about you, to have it corrected or deleted, and to object. Contact " + co + ". " + authorityLine(m.market, "en")
    ].filter(Boolean);
  }
  return [
    "Personuppgiftsansvarig: " + co + (m.settings.orgNumber ? " (org.nr " + m.settings.orgNumber + ")" : "") + ". Kontakt: " + contact + ".",
    "Personuppgiftsbiträde: TAHA Studio Labs, Örebro, driver sidan på uppdrag av " + co + ". Kontakt: " + m.tahaEmail + ".",
    m.formOn ? "Om du skickar en förfrågan sparar vi ditt namn, ditt telefonnummer eller din e-postadress och ditt meddelande, så att " + co + " kan svara dig. Den rättsliga grunden är " + co + " berättigade intresse av att svara på din förfrågan. Bara om du kryssar i rutan skickar " + co + " även erbjudanden till dig, med ditt samtycke som grund. Du kan ta tillbaka samtycket när du vill." : null,
    m.formOn ? "Förfrågningar lagras inom EU hos Cloudflare och raderas 90 dagar efter att erbjudandet har slutat" + (end ? " (" + end + ")" : "") + "." : null,
    "Besök räknas utan kakor. Din IP-adress sparas inte; ett slumpat värde som byts varje dygn används bara för att räkna unika besökare. Besöksdata raderas efter 90 dagar.",
    "Du har rätt att få veta vilka uppgifter som finns om dig, att få dem rättade eller raderade och att invända. Kontakta " + co + ". " + authorityLine(m.market, "sv")
  ].filter(Boolean);
}

export function jsonLd(m) {
  const o = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: m.company,
    url: m.canonical,
    description: noDash(m.description)
  };
  if (m.ogImage) o.image = m.ogImage;
  if (m.settings.phone) o.telephone = m.settings.phone;
  if (m.settings.email) o.email = m.settings.email;
  if (m.settings.address) o.address = { "@type": "PostalAddress", streetAddress: m.settings.address };
  if (m.settings.mapUrl) o.hasMap = m.settings.mapUrl;
  if (!m.ended && m.text.headline) {
    o.makesOffer = { "@type": "Offer", name: noDash(m.text.headline), description: clip(m.text.offer.framing, 300) };
    if (m.offerEnd) o.makesOffer.validThrough = m.offerEnd;
  }
  return '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, "\\u003c") + "</script>";
}

/* Builds the model the template is filled from. images: name to URL (hosted) or data URI. */
export function pageModel({ doc, text, profile, kit, page, images, origin, tahaEmail, mode, links, brainNotes, market }) {
  const s = page.settings || {};
  const lang = text.language;
  const company = noDash(s.companyName || (profile && profile.companyName) || "");
  const colors = pickColors(kit);
  const fonts = (kit && kit.fonts) || [];
  const offerEnd = page.offerEnd || "";
  const today = new Date().toISOString().slice(0, 10);
  return {
    mode,
    lang,
    market: market || "SE",
    t: L[lang],
    text,
    doc,
    company,
    settings: s,
    colors,
    fontHead: fontStack(fonts[0], "ui-serif, Georgia, 'Times New Roman', serif"),
    fontBody: fontStack(fonts[1], "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"),
    canonical: page.url,
    title: clip((text.headline || text.name) + " | " + company, 70),
    description: clip(text.subheadline || text.offer.framing, 160),
    offerEnd,
    offerEndText: formatDate(offerEnd, lang),
    ended: false,
    expiredNow: offerEnd && offerEnd < today,
    formOn: !!page.formOn,
    pageId: page.id,
    token: page.token,
    origin,
    tahaEmail: tahaEmail || "agborkak@gmail.com",
    images: images || {},
    ogImage: images && images.ogAbsolute ? images.ogAbsolute : "",
    links: links || [],
    brainNotes: brainNotes || {}
  };
}

function imgTag(m, base, alt, cls, sizes) {
  const im = m.images[base];
  if (!im) return "";
  if (typeof im === "string") return '<img class="' + cls + '" src="' + esc(im) + '" alt="' + esc(alt) + '" decoding="async">';
  const srcset = im.srcset.map((x) => esc(x.url) + " " + x.w + "w").join(", ");
  return '<img class="' + cls + '" src="' + esc(im.src) + '" srcset="' + srcset + '" sizes="' + sizes + '" alt="' + esc(alt) + '"' + (im.width ? ' width="' + im.width + '" height="' + im.height + '"' : "") + (cls === "hero-img" ? ' fetchpriority="high"' : ' loading="lazy" decoding="async"') + ">";
}

/* A page button. On the downloaded copy, buttons go through tracked short links (counted on
   the way) and carry no data-t, so a click is never counted twice. */
function button(m, type, cls, label) {
  let href = actionHref(m.settings, type);
  if (!href) return "";
  let track = ' data-t="' + type + '"';
  if (m.mode === "download" && type !== "form") {
    const l = m.links.find((x) => x.outputKey === "button." + type);
    if (l) href = l.url;
    track = "";
  }
  if (m.mode === "preview") track = "";
  const ext = /^https:/.test(href) ? ' rel="noopener"' : "";
  return '<a class="btn ' + cls + '" href="' + esc(href) + '"' + track + ext + ">" + esc(label || m.t[type]) + "</a>";
}

function mainSection(m) {
  const t = m.t;
  const text = m.text;
  const hasHero = !!m.images.hero;
  const primary = m.settings.primary && (m.settings.primary === "form" ? m.formOn : actionHref(m.settings, m.settings.primary)) ? m.settings.primary : availableActions(m.settings)[0] || (m.formOn ? "form" : "");
  const heroAlt = m.images.heroAlt || fill(t.photoAlt, { company: m.company });
  let h = '<div class="hero' + (hasHero ? "" : " no-img") + '">' + imgTag(m, "hero", heroAlt, "hero-img", "(min-width: 760px) 100vw, 100vw") +
    '<div class="hero-text"><h1>' + esc(m.ended ? t.endedTitle : text.headline) + "</h1>" +
    '<p class="sub">' + esc(m.ended ? fill(t.endedBody, { date: m.offerEndText }) : text.subheadline) + "</p>" +
    (m.ended ? "" : primary ? button(m, primary, "btn-main", text.cta || t[primary]) : "") + "</div></div>";
  if (m.ended) {
    h += visitSection(m);
    return h;
  }
  const of = text.offer;
  h += '<div class="wrap"><section class="offer" aria-labelledby="offer-h"><span class="kicker" id="offer-h">' + esc(t.offer) + "</span>" +
    '<p class="big">' + esc(of.framing) + "</p>" +
    (m.offerEndText ? '<p class="ends">' + esc(fill(t.ends, { date: m.offerEndText })) + "</p>" : of.deadline ? '<p class="ends">' + esc(of.deadline) + "</p>" : "") +
    (of.terms ? '<p class="terms">' + esc(of.terms) + "</p>" : "") +
    (of.riskReversal ? '<p class="terms">' + esc(of.riskReversal) + "</p>" : "") + "</section></div>";
  if (text.benefits.length) {
    h += '<section><div class="wrap"><h2>' + esc(t.reasons) + '</h2><div class="reasons">' +
      text.benefits.slice(0, 3).map((b, i) => '<div class="reason"><span class="n" aria-hidden="true">' + (i + 1) + "</span><h3>" + esc(b.title) + "</h3><p>" + esc(b.text) + "</p></div>").join("") + "</div></div></section>";
  }
  const gal = (m.images.gallery || []).filter(Boolean);
  if (gal.length) {
    h += '<section><div class="wrap"><h2>' + esc(t.gallery) + '</h2><div class="gallery">' +
      gal.map((g, i) => imgTag({ images: { g: g.img } }, "g", g.alt || fill(t.photoAlt, { company: m.company }), "", "(min-width: 760px) 33vw, 50vw")).join("") + "</div></div></section>";
  }
  const reviews = (m.settings.reviews || []).filter(Boolean);
  if (reviews.length) {
    h += '<section><div class="wrap"><h2>' + esc(t.reviews) + '</h2><div class="quotes">' + reviews.map((r) => "<blockquote>" + esc(r) + "</blockquote>").join("") + "</div></div></section>";
  }
  h += visitSection(m);
  if (m.formOn) h += formSection(m);
  return h;
}

function visitSection(m) {
  const t = m.t;
  const s = m.settings;
  const facts = [];
  if (s.hours) facts.push('<div class="fact"><b>' + esc(t.hours) + "</b>" + esc(s.hours) + "</div>");
  if (s.address) facts.push('<div class="fact"><b>' + esc(t.address) + "</b>" + esc(s.address) + "</div>");
  const c = [s.phone, s.email].filter(Boolean);
  if (c.length) facts.push('<div class="fact"><b>' + esc(t.contact) + "</b>" + c.map(esc).join("<br>") + "</div>");
  const acts = availableActions(s).map((a, i) => button(m, a, i === 0 ? "btn-main" : "btn-line")).join("");
  if (!facts.length && !acts) return "";
  return '<section class="visit"><div class="wrap"><h2>' + esc(t.visit) + "</h2>" + (facts.length ? '<div class="facts">' + facts.join("") + "</div>" : "") + (acts ? '<div class="actions">' + acts + "</div>" : "") + "</div></section>";
}

function formSection(m) {
  const t = m.t;
  const action = m.mode === "download" ? m.origin + VAULT + "/pub/lead/" + m.pageId : VAULT + "/pub/lead/" + m.pageId;
  const id = (k) => "f-" + k;
  return '<section id="enquiry"><div class="wrap"><h2>' + esc(t.formTitle) + "</h2>" +
    '<p class="sent" id="sent" role="status">' + esc(t.sent) + "</p>" +
    '<form method="post" action="' + esc(action) + '" data-lead>' +
    '<div class="full"><label for="' + id("name") + '">' + esc(t.name) + '</label><input type="text" id="' + id("name") + '" name="name" autocomplete="name" required maxlength="120"></div>' +
    '<div><label for="' + id("phone") + '">' + esc(t.phone) + '</label><input type="tel" id="' + id("phone") + '" name="phone" autocomplete="tel" maxlength="40"></div>' +
    '<div><label for="' + id("email") + '">' + esc(t.email) + '</label><input type="email" id="' + id("email") + '" name="email" autocomplete="email" maxlength="200"></div>' +
    '<p class="purpose full">' + esc(t.oneOf) + "</p>" +
    '<div class="full"><label for="' + id("message") + '">' + esc(t.message) + '</label><textarea id="' + id("message") + '" name="message" maxlength="2000"></textarea></div>' +
    '<label class="check full"><input type="checkbox" name="offers" value="1"> <span>' + esc(fill(t.offers, { company: m.company })) + "</span></label>" +
    '<div class="hp" aria-hidden="true"><label for="' + id("website") + '">Website</label><input type="text" id="' + id("website") + '" name="website" tabindex="-1" autocomplete="off"></div>' +
    '<input type="hidden" name="c" value=""><input type="hidden" name="src" value="">' +
    (m.mode === "download" ? '<input type="hidden" name="token" value="' + esc(m.token) + '">' : "") +
    '<p class="purpose full">' + esc(fill(t.purpose, { company: m.company })) + ' <a href="#privacy">' + esc(t.privacy) + "</a></p>" +
    '<div class="full"><button class="btn btn-main" type="submit">' + esc(t.send) + "</button></div>" +
    "</form></div></section>";
}

function footer(m) {
  const t = m.t;
  const s = m.settings;
  const bits = [s.address, s.phone, s.email].filter(Boolean).map(esc);
  if (s.orgNumber) bits.push(esc(t.org + " " + s.orgNumber));
  return '<p class="co">' + esc(m.company) + "</p>" + (bits.length ? "<p>" + bits.join(" · ") + "</p>" : "") +
    '<details id="privacy"><summary>' + esc(t.privacy) + "</summary><ul>" + privacyNotice(m).map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></details>" +
    '<p class="by"><a href="https://tahastudiolabs.com/" rel="noopener">' + esc(t.by) + "</a></p>";
}

function bar(m) {
  if (m.ended) return "";
  const acts = availableActions(m.settings);
  const first = m.settings.primary && (m.settings.primary === "form" ? m.formOn : acts.includes(m.settings.primary)) ? m.settings.primary : acts[0] || (m.formOn ? "form" : "");
  if (!first) return "";
  const second = acts.find((a) => a !== first && (a === "call" || a === "whatsapp"));
  return '<nav class="bar" aria-label="' + esc(m.t.contact) + '">' + button(m, first, "btn-main", first === m.settings.primary && m.text.cta ? clip(m.text.cta, 26) : m.t[first]) + (second ? button(m, second, "btn-line") : "") + "</nav>";
}

/* Fills the template. mode: hosted (stored in the Vault), download (one self-contained file)
   or preview (shown in the panel, nothing counted, form not sent). */
export function renderPage(template, m, opts = {}) {
  const ended = !!opts.ended;
  const mm = Object.assign({}, m, { ended });
  const tel = mm.settings.phone ? '<a class="tel" href="tel:' + esc(mm.settings.phone) + '"' + (mm.mode === "hosted" ? ' data-t="call"' : "") + ">" + esc(mm.settings.phone) + "</a>" : "";
  let tracker = "";
  if (mm.mode === "download" && mm.settings.countVisits) tracker = '<script src="' + esc(mm.origin) + '/go/t.js" data-p="' + esc(mm.pageId) + '" data-e="' + esc(mm.origin) + VAULT + '/pub/event" defer></script>';
  const vars = {
    LANG: mm.lang,
    TITLE: esc(ended ? mm.t.endedTitle + " | " + mm.company : mm.title),
    DESCRIPTION: esc(mm.description),
    ROBOTS: ended || mm.mode !== "hosted" ? '<meta name="robots" content="noindex">\n' : "",
    CANONICAL: esc(mm.canonical),
    OG_IMAGE: mm.ogImage ? '<meta property="og:image" content="' + esc(mm.ogImage) + '">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n' : "",
    BRAND: mm.colors.brand,
    ON_BRAND: mm.colors.onBrand,
    ACCENT: mm.colors.accent,
    ON_ACCENT: mm.colors.onAccent,
    FONT_HEAD: mm.fontHead,
    FONT_BODY: mm.fontBody,
    JSON_LD: jsonLd(mm),
    BODY_CLASS: ended ? "ended" : "",
    COMPANY: esc(mm.company),
    TOP_LINK: ended ? "" : tel,
    MAIN: mainSection(mm),
    FOOTER: footer(mm),
    BAR: bar(mm),
    TRACKER: tracker
  };
  /* Template tokens are filled once, in one pass, so text can never inject a token. */
  const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : ""));
  return noDash(html);
}

export function embedCode(url, title) {
  return '<iframe src="' + esc(url) + '" title="' + esc(title) + '" loading="lazy" style="width:100%;min-height:1800px;border:0" referrerpolicy="strict-origin-when-cross-origin"></iframe>';
}

/* The one-page guide that comes with the download, in both languages. */
export function guideHtml(company, url) {
  const steps = {
    sv: [
      ["WordPress", "Gå till Sidor, Lägg till ny, välj blocket Anpassad HTML och klistra in hela innehållet i filen. Eller be din webbansvariga ladda upp filen som en egen sida."],
      ["Wix", "Wix tar inte emot HTML-filer direkt. Lägg till Bädda in, Bädda in kod, och klistra in inbäddningskoden från TAHA i stället."],
      ["Squarespace", "Lägg till ett Kod-block på en ny sida och klistra in inbäddningskoden från TAHA."],
      ["Egen webbansvarig", "Skicka filen till den som sköter er webbplats. Den kan laddas upp som den är, till exempel som /erbjudande.html."]
    ],
    en: [
      ["WordPress", "Go to Pages, Add New, choose the Custom HTML block and paste the whole content of the file. Or ask your web person to upload the file as its own page."],
      ["Wix", "Wix does not take HTML files directly. Add Embed, Embed Code, and paste the embed code from TAHA instead."],
      ["Squarespace", "Add a Code block on a new page and paste the embed code from TAHA."],
      ["A web person", "Send the file to whoever runs your website. It can be uploaded as it is, for example as /offer.html."]
    ]
  };
  const block = (l, title, lead) => "<h2>" + esc(title) + "</h2><p>" + esc(lead) + "</p><ol>" + steps[l].map((x) => "<li><b>" + esc(x[0]) + ".</b> " + esc(x[1]) + "</li>").join("") + "</ol>";
  return noDash('<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(company) + ": kampanjsidan / the campaign page</title>" +
    "<style>body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.55;color:#1d1c1a}h1{font-size:24px}h2{font-size:19px;margin-top:28px}li{margin:8px 0}code{background:#f3f1ec;padding:2px 6px;border-radius:4px;word-break:break-all}</style></head><body>" +
    "<h1>" + esc(company) + "</h1><p>Sidan finns redan på / The page is already live at <code>" + esc(url) + "</code>. Den här filen behövs bara om ni vill ha sidan på er egen webbplats. / You only need this file if you want the page on your own website.</p>" +
    block("sv", "Lägg sidan på din webbplats", "Filen innehåller allt: text, bilder och knappar. Klick och förfrågningar räknas fortfarande.") +
    block("en", "Put the page on your website", "The file holds everything: text, images and buttons. Clicks and enquiries are still counted.") +
    "<p>Frågor? / Questions? TAHA Studio Labs, agborkak@gmail.com</p></body></html>");
}

/* QR code as SVG markup and as a PNG data URL (via canvas, browser only). */
export function qrMatrix(text) {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const rows = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(q.isDark(r, c));
    rows.push(row);
  }
  return rows;
}
export function qrSvg(text, dark = "#111111") {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let d = "";
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += "M" + (c + 4) + " " + (r + 4) + "h1v1h-1z"; }));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + " " + n + '" width="1024" height="1024" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path fill="' + dark + '" d="' + d + '"/></svg>';
}

/* ---------- the panel UI ---------- */

export function createLandingUi(ctx) {
  const { h, clear, api } = ctx;
  const state = {};
  let template = null;

  const key = (c, cp) => c + "/" + cp;
  function st(clientId, campaignId) {
    const k = key(clientId, campaignId);
    if (!state[k]) state[k] = { loaded: false, loading: false, page: null, links: [], suggest: null, form: null, busy: "", msg: null, preview: "", previewHtml: "", stats: null, statsLoading: false, leads: null, roi: null, roiMsg: null, showLinks: false };
    return state[k];
  }

  function load(clientId, campaignId, force) {
    const s = st(clientId, campaignId);
    if ((s.loaded && !force) || s.loading) return s;
    s.loading = true;
    api("/admin/page/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId)).then((r) => {
      s.loading = false;
      if (r.ok && r.d) {
        s.loaded = true;
        s.page = r.d.page;
        s.links = r.d.links || [];
        s.suggest = r.d.suggest;
        s.origin = r.d.origin;
        s.form = null;
      } else s.msg = { cls: "err", text: "Could not load the landing page." };
      ctx.rerender(clientId);
    });
    return s;
  }

  async function getTemplate() {
    if (!template) {
      const r = await fetch(TEMPLATE_URL, { credentials: "same-origin" });
      if (!r.ok) throw new Error("Could not load the landing page template.");
      template = await r.text();
    }
    return template;
  }

  /* The editable form, started from the saved page or from the intake and brain. */
  function formOf(s, info) {
    if (s.form) return s.form;
    const p = s.page;
    const profile = (info.d && info.d.intake && info.d.intake.profile) || {};
    const pics = ((info.d && info.d.files) || []).filter((f) => f.section === "pictures").map((f) => f.id);
    const reviews = ((profile.reviews && profile.reviews.pasted) || []).filter(Boolean);
    const set = p ? Object.assign({}, p.settings) : {
      companyName: profile.companyName || info.client.name,
      address: "",
      mapUrl: "",
      hours: "",
      phone: "",
      whatsapp: "",
      whatsappText: "",
      bookingUrl: "",
      orderUrl: "",
      email: "",
      orgNumber: "",
      primary: "",
      gallery: pics.slice(0, 6),
      reviews: reviews.slice(0, 4),
      countVisits: false
    };
    s.form = {
      clientSlug: p ? p.clientSlug : (s.suggest && s.suggest.clientSlug) || "",
      slug: p ? p.slug : (s.suggest && s.suggest.slug) || "",
      offerEnd: p ? p.offerEnd : "",
      formOn: p ? p.formOn : false,
      noticeApproved: p ? !!p.noticeVersion : false,
      prefix: (s.links.find((l) => l.offerCode) || { offerCode: "" }).offerCode.split("-")[0] || codePrefix(set.companyName),
      settings: set,
      dirty: false
    };
    return s.form;
  }

  async function save(info, quiet) {
    const { client, campaignId, doc } = info;
    const s = st(client.id, campaignId);
    const f = s.form;
    const body = {
      clientSlug: f.clientSlug.trim().toLowerCase(),
      slug: f.slug.trim().toLowerCase(),
      language: pageLanguage(doc.language),
      offerEnd: f.offerEnd,
      formOn: f.formOn,
      noticeApproved: f.formOn && f.noticeApproved,
      noticeVersion: NOTICE_VERSION,
      settings: f.settings,
      links: linkPlan(doc, f.prefix, f.settings)
    };
    const r = await api("/admin/page/" + encodeURIComponent(client.id) + "/" + encodeURIComponent(campaignId), { method: "PUT", body });
    if (!r.ok || !r.d) throw new Error((r.d && r.d.message && r.d.message.en) || "Could not save the page.");
    s.page = r.d.page;
    s.links = r.d.links || [];
    s.form.settings = Object.assign({}, s.page.settings);
    s.form.dirty = false;
    if (!quiet) s.msg = { cls: "ok", text: "Saved." };
    return s.page;
  }

  /* ----- images ----- */

  async function bitmapFrom(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error("Could not load an image (" + r.status + ").");
    return createImageBitmap(await r.blob());
  }
  function draw(bmp, w, h, cover) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (cover) {
      const scale = Math.max(w / bmp.width, h / bmp.height);
      const sw = w / scale, sh = h / scale;
      g.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, w, h);
    } else g.drawImage(bmp, 0, 0, w, h);
    return c;
  }
  function toBlob(canvas, type, q) {
    return new Promise((res) => canvas.toBlob((b) => res(b), type, q));
  }
  /* WebP where the browser can make it, JPEG otherwise. */
  async function encode(canvas, base) {
    let b = await toBlob(canvas, "image/webp", 0.8);
    if (b && b.type === "image/webp") return { blob: b, name: base + ".webp" };
    b = await toBlob(canvas, "image/jpeg", 0.84);
    return { blob: b, name: base + ".jpg" };
  }
  function blobToDataUrl(b) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(b);
    });
  }

  /* Where each picture comes from: the finished hero image Harry attached, else the client
     photo on the hero brief, else the first gallery photo. Link preview likewise. */
  function sources(info, f) {
    const dl = info.deliveries || [];
    const vis = (info.doc.visuals || []);
    const attached = (vid) => dl.find((x) => x.visualId === vid);
    const brief = (vid) => vis.find((v) => v.id === vid);
    const fileUrl = (id) => VAULT + "/files/" + encodeURIComponent(id);
    const heroD = attached("v_lp_hero");
    const heroB = brief("v_lp_hero");
    const lang = pageLanguage(info.doc.language);
    /* Alt text is written in Swedish and English; other page languages use the English one. */
    const altOf = (b) => (b && b.alt_text ? b.alt_text[lang] || b.alt_text.en || "" : "");
    let hero = null;
    if (heroD) hero = { url: heroD.url, alt: altOf(heroB) };
    else if (heroB && heroB.photo_ref) hero = { url: fileUrl(heroB.photo_ref), alt: altOf(heroB) };
    else if (f.settings.gallery[0]) hero = { url: fileUrl(f.settings.gallery[0]), alt: "" };
    const ogD = attached("v_lp_og");
    const notes = {};
    ((info.brain && info.brain.imageNotes) || []).forEach((n) => { notes[n.fileId] = n.caption; });
    return {
      hero,
      og: ogD ? { url: ogD.url } : hero,
      gallery: f.settings.gallery.map((id) => ({ id, url: fileUrl(id), alt: notes[id] || "" }))
    };
  }

  /* Makes every image. upload: true stores them in the Vault for the hosted page; otherwise
     they come back as data URIs (preview and download). */
  async function makeImages(info, f, upload, onStep) {
    const src = sources(info, f);
    const out = { gallery: [] };
    const put = async (enc) => {
      if (!upload) return blobToDataUrl(enc.blob);
      const r = await fetch(VAULT + "/admin/page/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId) + "/asset?name=" + encodeURIComponent(enc.name), {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": enc.blob.type }, body: enc.blob
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error((d && d.message && d.message.en) || "Could not upload an image.");
      return d.url;
    };
    if (src.hero) {
      onStep("Hero image");
      const bmp = await bitmapFrom(src.hero.url);
      const widths = upload ? [800, 1600] : [800];
      const set = [];
      for (const w of widths) {
        const ww = Math.min(w, bmp.width);
        const hh = Math.round((bmp.height * ww) / bmp.width);
        const enc = await encode(draw(bmp, ww, hh, false), "hero-" + w);
        set.push({ url: await put(enc), w: ww, h: hh });
      }
      out.hero = { src: set[0].url, srcset: set.map((x) => ({ url: x.url, w: x.w })), width: set[set.length - 1].w, height: set[set.length - 1].h };
      out.heroAlt = src.hero.alt;
    }
    if (src.og && upload) {
      onStep("Link preview image");
      const bmp = await bitmapFrom(src.og.url);
      const blob = await toBlob(draw(bmp, 1200, 630, true), "image/jpeg", 0.86);
      out.ogAbsolute = (info.origin || location.origin) + (await put({ blob, name: "og.jpg" }));
    }
    let total = 0;
    for (let i = 0; i < src.gallery.length; i++) {
      onStep("Gallery photo " + (i + 1) + " of " + src.gallery.length);
      try {
        const bmp = await bitmapFrom(src.gallery[i].url);
        const widths = upload ? [600, 1200] : [600];
        const set = [];
        for (const w of widths) {
          const ww = Math.min(w, bmp.width);
          const hh = Math.round((bmp.height * ww) / bmp.width);
          const enc = await encode(draw(bmp, ww, hh, false), "g" + (i + 1) + "-" + w);
          total += enc.blob.size;
          /* The downloaded file stays under 3 MB: stop adding photos before that. */
          if (!upload && total > 2.2 * 1024 * 1024) break;
          set.push({ url: await put(enc), w: ww, h: hh });
        }
        if (set.length) out.gallery.push({ img: { src: set[0].url, srcset: set.map((x) => ({ url: x.url, w: x.w })), width: set[set.length - 1].w, height: set[set.length - 1].h }, alt: src.gallery[i].alt });
      } catch (e) {
        /* A photo that cannot be read is left out, not a reason to stop. */
      }
    }
    return out;
  }

  function linksWithUrls(s, campaignId) {
    return s.links.map((l) => Object.assign({}, l, { full: s.page ? linkUrl(l, s.page, campaignId) : l.url }));
  }

  async function build(info, mode, images) {
    const s = st(info.client.id, info.campaignId);
    const tpl = await getTemplate();
    const text = campaignText(info.doc);
    const m = pageModel({
      doc: info.doc,
      text,
      profile: (info.d && info.d.intake && info.d.intake.profile) || {},
      kit: info.kit,
      page: s.page,
      images,
      origin: s.origin || location.origin,
      tahaEmail: "agborkak@gmail.com",
      mode,
      links: s.links,
      market: info.client.market
    });
    return { html: renderPage(tpl, m), ended: renderPage(tpl, m, { ended: true }), model: m };
  }

  function check(f, doc) {
    const probs = [];
    if (!SLUG_OK(f.clientSlug) || !SLUG_OK(f.slug)) probs.push("The address may only use lowercase a to z, digits and hyphens.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.offerEnd || "")) probs.push("Set the offer's end date.");
    if (!availableActions(f.settings).length && !f.formOn) probs.push("Add at least one way to reach the business (phone, WhatsApp, booking or order link, address) or turn the form on.");
    if (f.formOn && !f.noticeApproved) probs.push("With the form on, tick that the client has approved the page's privacy notice.");
    if (!doc.landingPage) probs.push("This campaign has no landing page text.");
    return probs;
  }
  const SLUG_OK = (v) => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(String(v || "").trim().toLowerCase());

  async function run(info, label, fn) {
    const s = st(info.client.id, info.campaignId);
    s.busy = label;
    s.msg = null;
    ctx.rerender(info.client.id);
    try {
      await fn((stepText) => { s.busy = label + ": " + stepText; ctx.rerender(info.client.id); });
    } catch (e) {
      s.msg = { cls: "err", text: e.message || String(e) };
    }
    s.busy = "";
    ctx.rerender(info.client.id);
  }

  function publish(info, langOverride) {
    return run(info, "Publishing", async (step) => {
      const s = st(info.client.id, info.campaignId);
      const probs = check(s.form, info.doc);
      if (probs.length) throw new Error(probs.join(" "));
      step("saving");
      await save(info, true);
      const images = await makeImages(info, s.form, true, step);
      step("building the page");
      const b = await build(info, "hosted", images);
      step("sending it to the Vault");
      const r = await api("/admin/page/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId) + "/publish", { method: "POST", body: langOverride ? { html: b.html, endedHtml: b.ended, langOverride } : { html: b.html, endedHtml: b.ended } });
      /* V2 Part H: a Swedish page waits for approved text. */
      if (r.status === 409 && r.d && r.d.error === "lang_pending") {
        s.langAsk = true;
        throw new Error(r.d.message.en + " Approve them in the Language review box, or give a reason to publish anyway.");
      }
      s.langAsk = false;
      if (!r.ok || !r.d) throw new Error((r.d && r.d.message && r.d.message.en) || "Could not publish the page.");
      s.page = r.d.page;
      s.links = r.d.links || s.links;
      s.msg = { cls: "ok", text: "Published, version " + s.page.version + ". The link stays the same on every update." };
    });
  }

  function preview(info, width) {
    return run(info, "Building the preview", async (step) => {
      const s = st(info.client.id, info.campaignId);
      if (s.form.dirty || !s.page) { step("saving"); await save(info, true); }
      const images = await makeImages(info, s.form, false, step);
      const b = await build(info, "preview", images);
      s.preview = width;
      s.previewHtml = b.html;
      s.previewEnded = b.ended;
    });
  }

  function download(info) {
    return run(info, "Making the download", async (step) => {
      const s = st(info.client.id, info.campaignId);
      if (s.form.dirty || !s.page) { step("saving"); await save(info, true); }
      const images = await makeImages(info, s.form, false, step);
      const b = await build(info, "download", images);
      const slug = s.page.clientSlug + "-" + s.page.slug;
      saveFile(slug + ".html", b.html, "text/html");
      saveFile(slug + "-guide.html", guideHtml(b.model.company, s.page.url), "text/html");
      const kb = Math.round(new Blob([b.html]).size / 1024);
      s.msg = { cls: "ok", text: "Downloaded " + slug + ".html (" + kb + " KB) and the guide." };
    });
  }

  function unpublish(info) {
    return run(info, "Taking the page down", async () => {
      const s = st(info.client.id, info.campaignId);
      const r = await api("/admin/page/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId) + "/unpublish", { method: "POST", body: {} });
      if (!r.ok || !r.d) throw new Error("Could not take the page down.");
      s.page = r.d.page;
      s.msg = { cls: "ok", text: "The page is down. Its link now answers 410 Gone. Publish again to bring it back." };
    });
  }

  function saveFile(name, data, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function qrPng(text) {
    const m = qrMatrix(text);
    const scale = 16, n = m.length + 8;
    const c = document.createElement("canvas");
    c.width = c.height = n * scale;
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#111";
    m.forEach((row, r) => row.forEach((on, col) => { if (on) g.fillRect((col + 4) * scale, (r + 4) * scale, scale, scale); }));
    return new Promise((res) => c.toBlob(res, "image/png"));
  }

  function copy(text, el) {
    const done = () => { if (el) { el.textContent = "Copied."; setTimeout(() => { el.textContent = ""; }, 2500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
    else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      ta.remove();
    }
  }

  /* ----- rendering ----- */

  function inp(label, value, onInput, attrs) {
    const id = "lp-" + Math.random().toString(36).slice(2, 9);
    const el = h("input", Object.assign({ id, type: "text" }, attrs || {}));
    el.value = value == null ? "" : value;
    el.addEventListener("input", () => onInput(el.value));
    return h("div", { class: "gc-ed" }, h("label", { for: id, text: label }), el);
  }
  function tick(label, checked, onChange) {
    const id = "lp-" + Math.random().toString(36).slice(2, 9);
    const el = h("input", { id, type: "checkbox" });
    el.checked = !!checked;
    el.addEventListener("change", () => onChange(el.checked));
    return h("label", { for: id, class: "lp-tick" }, el, h("span", { text: label }));
  }

  function renderBox(pane, info) {
    const { client, campaignId, doc } = info;
    const s = load(client.id, campaignId);
    const box = h("div", { class: "gc-box lp-box" });
    const p = s.page;
    const stateText = !p ? "Not made yet" : p.state === "published" ? (p.ended ? "Published · offer ended, showing the ended message" : "Published · version " + p.version) : p.state === "unpublished" ? "Taken down (410)" : "Draft, not published";
    box.appendChild(h("div", { class: "gc-bh" }, "Landing page", h("span", { text: stateText })));
    if (!s.loaded) {
      box.appendChild(h("div", { class: "gc-meta" }, h("span", { class: "spin" }), "Loading..."));
      pane.appendChild(box);
      return;
    }
    if (!doc.landingPage) {
      box.appendChild(h("div", { class: "gc-msg info", text: "This campaign has no landing page text, so it cannot have a page." }));
      pane.appendChild(box);
      return;
    }
    const f = formOf(s, info);
    const dirty = () => {
      if (!f.dirty) { f.dirty = true; ctx.rerender(client.id); }
    };
    const set = (k) => (v) => { f.settings[k] = v; dirty(); };
    const origin = s.origin || location.origin;

    /* Every published page gets a short link; pages published before it existed get one here. */
    const share = s.links.find((l) => l.outputKey === "share.main");
    if (p && !share && !s.busy && !s.shareTried && !(s.form && s.form.dirty)) {
      s.shareTried = true;
      formOf(s, info);
      save(info, true).then(() => ctx.rerender(client.id), () => {});
    }
    if (p && p.state === "published") {
      const linkRow = h("div", { class: "lp-live" });
      const m = h("span", { class: "gc-meta", role: "status" });
      if (share) {
        linkRow.appendChild(h("a", { href: share.url, target: "_blank", rel: "noopener", class: "lp-url lp-short", text: share.url.replace(/^https?:\/\//, "") }));
        linkRow.appendChild(h("button", { type: "button", class: "btn-copy", on: { click: () => copy(share.url, m) } }, "Copy short link"));
      }
      linkRow.appendChild(h("a", { href: p.url, target: "_blank", rel: "noopener", class: "lp-url", text: p.url }));
      linkRow.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => copy(p.url, m) } }, "Copy full link"));
      linkRow.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => copy(embedCode(p.url, doc.name), m) } }, "Copy embed code"));
      linkRow.appendChild(m);
      box.appendChild(linkRow);
    }

    /* Address */
    const addr = h("div", { class: "lp-grid" });
    addr.appendChild(inp("Client part of the address", f.clientSlug, (v) => { f.clientSlug = v; dirty(); }, { autocapitalize: "off", spellcheck: "false" }));
    addr.appendChild(inp("Campaign part", f.slug, (v) => { f.slug = v; dirty(); }, { autocapitalize: "off", spellcheck: "false" }));
    addr.appendChild(inp("Offer ends (the page then shows the ended message)", f.offerEnd, (v) => { f.offerEnd = v; dirty(); }, { type: "date" }));
    box.appendChild(addr);
    box.appendChild(h("div", { class: "gc-meta", text: "Address: " + origin + "/go/" + (f.clientSlug || "client") + "/" + (f.slug || "campaign") + ". It is taken down 30 days after the offer ends." }));

    /* How to reach the business */
    box.appendChild(h("div", { class: "gc-label", text: "How customers reach the business" }));
    const reach = h("div", { class: "lp-grid" });
    reach.appendChild(inp("Business name on the page", f.settings.companyName, set("companyName")));
    reach.appendChild(inp("WhatsApp number (with country code)", f.settings.whatsapp, set("whatsapp"), { inputmode: "tel", placeholder: "46701234567" }));
    reach.appendChild(inp("Phone", f.settings.phone, set("phone"), { inputmode: "tel", placeholder: "+46 70 123 45 67" }));
    reach.appendChild(inp("Booking link (https)", f.settings.bookingUrl, set("bookingUrl"), { type: "url" }));
    reach.appendChild(inp("Order link (https)", f.settings.orderUrl, set("orderUrl"), { type: "url" }));
    reach.appendChild(inp("Email for customers", f.settings.email, set("email"), { type: "email" }));
    reach.appendChild(inp("Street address", f.settings.address, set("address")));
    reach.appendChild(inp("Map link (optional, https)", f.settings.mapUrl, set("mapUrl"), { type: "url" }));
    reach.appendChild(inp("Opening hours", f.settings.hours, set("hours"), { placeholder: "Mon to Fri 8 to 22" }));
    reach.appendChild(inp("WhatsApp message they start with (optional)", f.settings.whatsappText, set("whatsappText")));
    reach.appendChild(inp("Org. number (optional)", f.settings.orgNumber, set("orgNumber")));
    const acts = availableActions(f.settings).concat(f.formOn ? ["form"] : []);
    const primId = "lp-prim-" + client.id;
    const prim = h("select", { id: primId, class: "gc-select" }, [h("option", { value: "" }, "First available")].concat(acts.map((a) => h("option", { value: a, selected: f.settings.primary === a }, L.en[a]))));
    prim.addEventListener("change", () => { f.settings.primary = prim.value; dirty(); });
    reach.appendChild(h("div", { class: "gc-ed" }, h("label", { for: primId, text: "Main button" }), prim));
    box.appendChild(reach);

    /* Photos and reviews */
    const pics = ((info.d && info.d.files) || []).filter((x) => x.section === "pictures");
    if (pics.length) {
      box.appendChild(h("div", { class: "gc-label", text: "Gallery: the client's own photos (" + f.settings.gallery.length + " chosen, up to 12)" }));
      const g = h("div", { class: "lp-pics" });
      pics.forEach((x) => {
        const on = f.settings.gallery.includes(x.id);
        g.appendChild(h("button", { type: "button", class: "lp-pic" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", title: x.name || x.id, on: { click: () => {
          f.settings.gallery = on ? f.settings.gallery.filter((y) => y !== x.id) : f.settings.gallery.concat([x.id]).slice(0, 12);
          f.dirty = true;
          ctx.rerender(client.id);
        } } }, h("img", { src: VAULT + "/files/" + x.id, alt: x.name || "Client photo", loading: "lazy" })));
      });
      box.appendChild(g);
    }
    const profile = (info.d && info.d.intake && info.d.intake.profile) || {};
    const real = ((profile.reviews && profile.reviews.pasted) || []).filter(Boolean);
    box.appendChild(h("div", { class: "gc-label", text: "Reviews: only real ones the client gave in the intake" }));
    if (!real.length) box.appendChild(h("div", { class: "gc-meta", text: "The client gave no reviews, so the page has no reviews section." }));
    real.forEach((rv) => {
      box.appendChild(tick("“" + clip(rv, 160) + "”", f.settings.reviews.includes(rv), (on) => {
        f.settings.reviews = on ? f.settings.reviews.concat([rv]) : f.settings.reviews.filter((y) => y !== rv);
        dirty();
      }));
    });

    /* Form and privacy */
    box.appendChild(h("div", { class: "gc-label", text: "Enquiry form" }));
    box.appendChild(tick("Show the enquiry form (name, phone or email, message)", f.formOn, (v) => { f.formOn = v; f.noticeApproved = v && f.noticeApproved; f.dirty = true; ctx.rerender(client.id); }));
    if (f.formOn) {
      box.appendChild(tick("The client has read and approved the page's privacy notice (she is the controller, TAHA the processor)", f.noticeApproved, (v) => { f.noticeApproved = v; dirty(); }));
      box.appendChild(h("div", { class: "gc-meta", text: "Preview the page to read the notice at the bottom. Enquiries go to her portal (Your enquiries) and are deleted 90 days after the offer ends." }));
    }
    box.appendChild(tick("Count visits on the downloaded copy too (adds a small cookieless counter)", f.settings.countVisits, set("countVisits")));

    /* Actions */
    const probs = check(f, doc);
    const tools = h("div", { class: "gc-brain-tools" });
    const busy = !!s.busy;
    tools.appendChild(h("button", { type: "button", class: f.dirty || !p ? "gc-brain-btn" : "btn-ghost", disabled: busy, on: { click: () => run(info, "Saving", () => save(info)) } }, "Save"));
    tools.appendChild(h("button", { type: "button", class: "btn-ghost", disabled: busy, on: { click: () => preview(info, "phone") } }, "Preview"));
    tools.appendChild(h("button", { type: "button", class: "gc-brain-btn", disabled: busy || probs.length > 0, title: probs.join(" "), on: { click: () => publish(info) } }, p && p.state === "published" ? "Update the live page" : "Publish"));
    if (p && p.state === "published") tools.appendChild(h("button", { type: "button", class: "btn-ghost", disabled: busy, on: { click: () => unpublish(info) } }, "Take down"));
    tools.appendChild(h("button", { type: "button", class: "gc-link", disabled: busy, on: { click: () => download(info) } }, "Download as HTML"));
    box.appendChild(tools);
    if (probs.length && !busy) box.appendChild(h("div", { class: "gc-meta", text: "Before publishing: " + probs.join(" ") }));
    if (s.busy) box.appendChild(h("div", { class: "gc-msg info" }, h("span", { class: "spin" }), s.busy + "..."));
    if (s.msg) box.appendChild(h("div", { class: "gc-msg " + s.msg.cls, role: "status", text: s.msg.text }));
    if (s.langAsk && !busy) {
      const wid = "lp-lang-why-" + client.id;
      const why = h("input", { type: "text", id: wid, placeholder: "For example: page goes live now, Swedish check tomorrow" });
      box.appendChild(h("div", { class: "gc-ed" }, h("label", { for: wid, text: "Reason to publish before language review (logged)" }), why));
      box.appendChild(h("button", { type: "button", class: "btn-ghost", on: { click: () => { if (why.value.trim().length >= 5) publish(info, why.value.trim()); else why.focus(); } } }, "Publish anyway"));
    }

    if (s.preview && s.previewHtml) {
      const bar = h("div", { class: "gc-brain-tools" });
      [["phone", "Phone 390 px"], ["desktop", "Desktop 1280 px"], ["ended", "Ended message"]].forEach((x) => {
        bar.appendChild(h("button", { type: "button", class: s.preview === x[0] ? "gc-brain-btn" : "btn-ghost", on: { click: () => { s.preview = x[0]; ctx.rerender(client.id); } } }, x[1]));
      });
      bar.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { s.preview = ""; s.previewHtml = ""; ctx.rerender(client.id); } } }, "Close preview"));
      box.appendChild(bar);
      const w = s.preview === "desktop" ? 1280 : 390;
      const frame = h("iframe", { class: "lp-frame", title: "Landing page preview", sandbox: "", style: "width:" + w + "px;height:760px" });
      frame.srcdoc = s.preview === "ended" ? s.previewEnded : s.previewHtml;
      box.appendChild(h("div", { class: "lp-frame-wrap" }, frame));
    }

    /* Tracked links, offer codes and QR codes */
    if (s.links.length && p) {
      const head = h("div", { class: "gc-brain-tools" },
        h("div", { class: "gc-label", text: "Tracked links and offer codes (" + s.links.filter((l) => l.medium !== "button").length + ")" }),
        h("button", { type: "button", class: "gc-link", on: { click: () => { s.showLinks = !s.showLinks; ctx.rerender(client.id); } } }, s.showLinks ? "Hide" : "Show"));
      box.appendChild(head);
      box.appendChild(inp("Offer code prefix", f.prefix, (v) => { f.prefix = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); dirty(); }));
      if (s.showLinks) {
        const text = campaignText(doc);
        const tbl = h("div", { class: "lp-links" });
        linksWithUrls(s, campaignId).filter((l) => l.medium !== "button").forEach((l) => {
          const m = h("span", { class: "gc-meta", role: "status" });
          const row = h("div", { class: "lp-link" },
            h("div", { class: "lp-link-t" }, h("b", { text: l.label || l.outputKey }), h("span", { class: "gc-meta", text: (CHANNEL_LABEL[l.channel] || l.channel) + (l.offerCode ? " · code " + l.offerCode : "") })),
            h("code", { class: "lp-code", text: l.full }));
          const acts2 = h("div", { class: "gc-card-actions" });
          acts2.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => copy(l.full, m) } }, "Copy link"));
          const withText = textWithLink(text, l.outputKey, l.full, l.offerCode, text.language);
          if (withText) acts2.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => copy(withText, m) } }, "Copy text with link"));
          if (l.medium === "print") {
            acts2.appendChild(h("button", { type: "button", class: "gc-link", on: { click: async () => saveFile("qr-" + l.outputKey.replace(/\W+/g, "-") + ".png", await qrPng(l.url), "image/png") } }, "QR PNG"));
            acts2.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => saveFile("qr-" + l.outputKey.replace(/\W+/g, "-") + ".svg", qrSvg(l.url), "image/svg+xml") } }, "QR SVG"));
          }
          acts2.appendChild(m);
          row.appendChild(acts2);
          tbl.appendChild(row);
        });
        box.appendChild(tbl);
        box.appendChild(h("div", { class: "gc-meta", text: "Online posts and ads get the full link with UTM fields; bios, print and the video get the short link. Each channel has its own offer code, so in-store redemptions can be traced. Saving keeps every code." }));
      }
    }
    pane.appendChild(box);
  }

  /* ----- Performance (ROI) ----- */

  function loadStats(clientId, campaignId, force) {
    const s = st(clientId, campaignId);
    if ((s.stats && !force) || s.statsLoading) return s;
    s.statsLoading = true;
    Promise.all([
      api("/admin/stats/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId)),
      api("/admin/leads/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId))
    ]).then(([a, b]) => {
      s.statsLoading = false;
      s.stats = a.ok && a.d ? a.d : { error: true };
      s.leads = b.ok && b.d ? b.d.leads : [];
      if (s.stats && !s.stats.error) {
        s.roi = {
          before: Object.assign({}, s.stats.baselines.before),
          after: Object.assign({}, s.stats.baselines.after),
          costs: JSON.parse(JSON.stringify(s.stats.costs)),
          dirty: false
        };
      }
      ctx.rerender(clientId);
    });
    return s;
  }

  function money(v, cur) {
    return formatMoney(v, cur);
  }
  function pct(v) {
    if (v == null) return "-";
    return (v > 0 ? "+" : "") + Math.round(v * 100) + "%";
  }

  function metricKeys(doc, links) {
    const base = [
      ["orders", "Orders or bookings"],
      ["new_customers", "New customers"],
      ["gbp_views", "Google Business profile views"],
      ["gbp_calls", "Google Business calls"]
    ];
    (doc.channels || []).filter((c) => c !== "email" && c !== "google_business" && c !== "whatsapp").forEach((c) => base.push(["followers_" + c, "Followers on " + (CHANNEL_LABEL[c] || c)]));
    const codes = Array.from(new Set(links.filter((l) => l.offerCode).map((l) => l.offerCode)));
    codes.forEach((c) => base.push(["redemptions-" + c, "Redemptions of " + c]));
    return base;
  }

  async function saveRoi(info) {
    const s = st(info.client.id, info.campaignId);
    const base = "/" + encodeURIComponent(info.client.id) + "/" + encodeURIComponent(info.campaignId);
    const nums = (o) => { const x = {}; Object.keys(o).forEach((k) => { x[k] = o[k] === "" || o[k] == null ? null : Number(o[k]); }); return x; };
    const a = await api("/admin/baseline" + base, { method: "PUT", body: { before: nums(s.roi.before), after: nums(s.roi.after) } });
    const b = await api("/admin/costs" + base, { method: "PUT", body: s.roi.costs });
    s.roiMsg = a.ok && b.ok ? { cls: "ok", text: "Saved." } : { cls: "err", text: "Could not save the numbers. Check that every value is a number." };
    loadStats(info.client.id, info.campaignId, true);
  }

  function renderPerformance(pane, info) {
    const { client, campaignId, doc } = info;
    const s = st(client.id, campaignId);
    if (!s.page || s.page.state === "draft") return;
    loadStats(client.id, campaignId);
    const box = h("div", { class: "gc-box lp-box" });
    box.appendChild(h("div", { class: "gc-bh" }, "Performance", h("span", { text: "before and after, per channel" })));
    if (!s.stats || !s.roi) {
      box.appendChild(h("div", { class: "gc-meta" }, h("span", { class: "spin" }), "Loading..."));
      pane.appendChild(box);
      return;
    }
    const st2 = s.stats;
    const r = st2.roi;
    const cur = (s.roi.costs && s.roi.costs.currency) || "SEK";
    const curLabel = currencyLabel(cur);
    const tiles = [
      ["Visits", r.totals.views], ["Visitors", r.totals.uniques], ["Button clicks", r.totals.clicks], ["QR scans", r.totals.scans], ["Enquiries", r.totals.enquiries],
      ["Cost per enquiry", money(r.costPerEnquiry, cur)], ["Cost per new customer", money(r.costPerNewCustomer, cur)],
      ["Estimated return", r.estimatedReturn == null ? "-" : r.estimatedReturn + " x"], ["Best channel", r.bestChannel ? (CHANNEL_LABEL[r.bestChannel.channel] || r.bestChannel.channel) : "-"]
    ];
    box.appendChild(h("div", { class: "lp-tiles" }, tiles.map((t) => h("div", { class: "lp-tile" }, h("b", { text: String(t[1]) }), h("span", { text: t[0] })))));
    if (r.bestChannel && r.bestChannel.basis === "actions") box.appendChild(h("div", { class: "gc-meta", text: "Best channel is by enquiries and clicks until redemptions per offer code are entered below." }));
    if (r.channels.length) {
      const rows = r.channels.map((c) => h("tr", null,
        h("td", { text: CHANNEL_LABEL[c.channel] || c.channel }), h("td", { text: String(c.views) }), h("td", { text: String(c.clicks) }), h("td", { text: String(c.scans) }),
        h("td", { text: String(c.enquiries) }), h("td", { text: c.newCustomers == null ? "-" : String(c.newCustomers) }), h("td", { text: money(c.costPerNewCustomer, cur) })));
      box.appendChild(h("div", { class: "lp-table-wrap" }, h("table", { class: "lp-table" },
        h("thead", null, h("tr", null, ["Channel", "Visits", "Clicks", "Scans", "Enquiries", "New customers", "Cost per new customer"].map((x) => h("th", { text: x })))),
        h("tbody", null, rows))));
    } else box.appendChild(h("div", { class: "gc-meta", text: "No visits counted yet. Your own signed-in visits are never counted." }));

    /* Before, after and costs */
    const keys = metricKeys(doc, st2.links || []);
    const grid = h("div", { class: "lp-roi" });
    grid.appendChild(h("div", { class: "lp-roi-h" }, h("span", { text: "" }), h("span", { text: "Before" }), h("span", { text: "After" }), h("span", { text: "Change" })));
    keys.forEach(([k, label]) => {
      const mk = (period) => {
        const el = h("input", { type: "number", min: "0", step: "any", "aria-label": label + " " + period, class: "lp-num" });
        el.value = s.roi[period][k] == null ? "" : s.roi[period][k];
        el.addEventListener("input", () => { s.roi[period][k] = el.value; s.roi.dirty = true; });
        return el;
      };
      const isCode = k.startsWith("redemptions-");
      grid.appendChild(h("div", { class: "lp-roi-r" }, h("span", { text: label }), isCode ? h("span", { class: "gc-meta", text: "" }) : mk("before"), mk("after"), h("span", { class: "gc-meta", text: pct(r.change[k]) })));
    });
    box.appendChild(h("div", { class: "gc-label", text: "Before and after (the client can also report these later in Part D)" }));
    box.appendChild(inp("Before period (for example September 2026)", s.roi.costs.baselinePeriod, (v) => { s.roi.costs.baselinePeriod = v; s.roi.dirty = true; }));
    box.appendChild(grid);
    box.appendChild(h("div", { class: "gc-label", text: "Costs" }));
    const cg = h("div", { class: "lp-grid" });
    cg.appendChild(inp("Campaign fee (" + curLabel + ")" + (s.roi.costs.feeFromMarket ? ", the market's default until you save" : ""), s.roi.costs.fee, (v) => { s.roi.costs.fee = v; s.roi.dirty = true; }, { type: "number", min: "0", step: "any" }));
    cg.appendChild(inp("Average order value (" + curLabel + ")", s.roi.costs.avgOrderValue == null ? "" : s.roi.costs.avgOrderValue, (v) => { s.roi.costs.avgOrderValue = v === "" ? null : v; s.roi.dirty = true; }, { type: "number", min: "0", step: "any" }));
    /* The client's market sets the currency; it can still be changed for one campaign here. */
    const curSel = h("select", { id: "lpCurrency" }, currencyList().map((c) => h("option", { value: c.code, selected: c.code === cur }, c.label + " (" + c.name + ")")));
    curSel.addEventListener("change", () => { s.roi.costs.currency = curSel.value; s.roi.dirty = true; ctx.rerender(client.id); });
    cg.appendChild(h("div", { class: "gc-ed" }, h("label", { for: "lpCurrency", text: "Currency" }), curSel));
    Array.from(new Set((doc.channels || []).map((c) => (c === "google_business" ? "google" : c)))).forEach((c) => {
      cg.appendChild(inp("Ad spend on " + (CHANNEL_LABEL[c] || c), (s.roi.costs.adSpend || {})[c] || "", (v) => { s.roi.costs.adSpend = Object.assign({}, s.roi.costs.adSpend, { [c]: v }); s.roi.dirty = true; }, { type: "number", min: "0", step: "any" }));
    });
    box.appendChild(cg);
    const tools = h("div", { class: "gc-brain-tools" },
      h("button", { type: "button", class: "gc-brain-btn", on: { click: () => saveRoi(info) } }, "Save the numbers"),
      h("button", { type: "button", class: "gc-link", on: { click: () => loadStats(client.id, campaignId, true) } }, "Refresh counts"));
    box.appendChild(tools);
    if (s.roiMsg) box.appendChild(h("div", { class: "gc-msg " + s.roiMsg.cls, role: "status", text: s.roiMsg.text }));

    /* Enquiries */
    const leads = s.leads || [];
    box.appendChild(h("div", { class: "gc-label", text: "Enquiries (" + leads.length + ")" }));
    if (!leads.length) box.appendChild(h("div", { class: "gc-meta", text: s.page.formOn ? "None yet. The client sees them in her portal under Your enquiries." : "The enquiry form is off for this page." }));
    leads.slice(0, 30).forEach((l) => {
      box.appendChild(h("div", { class: "lp-lead" },
        h("b", { text: l.name }), h("span", { class: "gc-meta", text: [l.phone, l.email].filter(Boolean).join(" · ") + " · " + (CHANNEL_LABEL[l.channel] || l.channel) + " · " + (ctx.when ? ctx.when(l.at) : l.at) + (l.state === "contacted" ? " · contacted" : "") }),
        l.message ? h("p", { text: l.message }) : null));
    });
    pane.appendChild(box);
  }

  return { renderBox, renderPerformance, state: st };
}
