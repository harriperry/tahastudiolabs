/* Outgoing email: magic links and invites, always in both Swedish and English.
   Providers (MAIL_PROVIDER):
     gmail-smtp  sends through Gmail with an app password (SMTP_PASSWORD secret). Default.
     resend      sends through Resend (RESEND_API_KEY secret). Needs a verified sending
                 domain, so use it once hej@tahastudiolabs.com exists. Create the Resend
                 domain in the EU region (eu-west-1).
     log         development only: prints the email to the local console. Refused in production.
   Emails never contain client business content, only names, links and status words. */
import { smtpSend, buildMessage } from "./smtp.js";
import { escapeHtml, noDashes } from "./util.js";

export async function sendMail(cfg, env, { to, subject, text, html }) {
  subject = noDashes(subject);
  text = noDashes(text);
  html = noDashes(html);
  const from = cfg.tahaEmail;
  if (cfg.mailProvider === "log") {
    if (cfg.environment === "production") throw new Error("MAIL_PROVIDER=log is not allowed in production");
    console.log("[dev mail] to=" + to + " subject=" + subject + "\n" + text);
    return { ok: true, provider: "log" };
  }
  if (cfg.mailProvider === "resend") {
    if (!cfg.resendKey) throw new Error("RESEND_API_KEY is not set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.fromName + " <" + from + ">",
        to: [to],
        reply_to: from,
        subject,
        text,
        html
      })
    });
    if (!res.ok) throw new Error("Resend failed with " + res.status);
    return { ok: true, provider: "resend" };
  }
  if (cfg.mailProvider === "gmail-smtp") {
    if (!cfg.smtp.pass && cfg.smtp.secure !== "off") throw new Error("SMTP_PASSWORD is not set");
    const message = buildMessage({ fromName: cfg.fromName, from, to, replyTo: from, subject, text, html });
    await smtpSend(
      {
        host: cfg.smtp.host,
        port: cfg.smtp.port,
        secure: cfg.smtp.secure,
        user: cfg.smtp.user,
        pass: cfg.smtp.pass,
        from,
        to,
        heloName: new URL(cfg.siteOrigin).hostname
      },
      message
    );
    return { ok: true, provider: "gmail-smtp" };
  }
  throw new Error("Unknown MAIL_PROVIDER");
}

const COPY = {
  login: {
    subject: { sv: "Din inloggningslänk", en: "Your login link" },
    intro: {
      sv: "Hej! Klicka på knappen nedan för att logga in.",
      en: "Hi! Click the button below to sign in."
    },
    button: { sv: "Logga in", en: "Sign in" },
    note: {
      sv: "Länken fungerar en gång och gäller i {min} minuter. Om du inte bad om den kan du ignorera mejlet.",
      en: "The link works once and is valid for {min} minutes. If you did not ask for it, you can ignore this email."
    }
  },
  invite: {
    subject: { sv: "Välkommen till {product}", en: "Welcome to {product}" },
    intro: {
      sv: "Hej {name}! Du är inbjuden till {product}. Där berättar du om ditt företag, så bygger vi din marknadsstrategi och dina kampanjer.",
      en: "Hi {name}! You are invited to {product}. There you tell us about your business, and we build your marketing strategy and campaigns."
    },
    button: { sv: "Logga in och kom igång", en: "Sign in and get started" },
    note: {
      sv: "Länken fungerar en gång och gäller i {min} minuter. Har den gått ut? Begär en ny länk här: {signin}",
      en: "The link works once and is valid for {min} minutes. Has it expired? Request a new link here: {signin}"
    }
  },
  /* V2 phase G2a. No campaign content: only that photos are wanted, and where. */
  photos: {
    subject: { sv: "Vi behöver några bilder från dig", en: "We need a few photos from you" },
    intro: {
      sv: "Hej {name}! Till din nästa kampanj behöver vi {count} {photoWordSv} från dig. I portalen ser du exakt vad vi behöver, och du laddar upp dem direkt där.",
      en: "Hi {name}! For your next campaign we need {count} {photoWordEn} from you. The portal shows exactly what we need, and you upload them right there."
    },
    button: { sv: "Öppna portalen", en: "Open the portal" },
    note: {
      sv: "Är du inte inloggad? Ange din e-postadress i portalen så får du en inloggningslänk.",
      en: "Not signed in? Enter your email address in the portal and you will get a login link."
    }
  },
  /* V2 Part A. No campaign content: only that a campaign is ready to look at. */
  review: {
    subject: { sv: "Din kampanj är klar att granska", en: "Your campaign is ready for you to review" },
    intro: {
      sv: "Hej {name}! Din kampanj är klar. Titta igenom den i portalen, säg till om något ska ändras eller godkänn den, så gör vi klart allt.",
      en: "Hi {name}! Your campaign is ready. Look through it in the portal, tell us what to change or approve it, and we will finish everything."
    },
    button: { sv: "Granska kampanjen", en: "Review the campaign" },
    note: {
      sv: "Inte inloggad? Ange din e-postadress i portalen så får du en inloggningslänk.",
      en: "Not signed in? Enter your email address in the portal and you will get a login link."
    }
  },
  /* V2 Part B. The finished campaign is in the portal. */
  delivered: {
    subject: { sv: "Ditt kampanjmaterial är klart", en: "Your campaign content is ready" },
    intro: {
      sv: "Hej {name}! Allt material till din kampanj finns nu i portalen: texter att kopiera, bilder och filer att ladda ner.",
      en: "Hi {name}! Everything for your campaign is now in the portal: texts to copy, and images and files to download."
    },
    button: { sv: "Öppna ditt material", en: "Open your content" },
    note: {
      sv: "Inte inloggad? Ange din e-postadress i portalen så får du en inloggningslänk.",
      en: "Not signed in? Enter your email address in the portal and you will get a login link."
    }
  },
  /* V2 phase G2b. No enquiry content: only that one is waiting, and where to read it. */
  enquiry: {
    subject: { sv: "Ny förfrågan från din kampanjsida", en: "New enquiry from your campaign page" },
    intro: {
      sv: "Hej {name}! Någon har skickat en förfrågan via din kampanjsida. Logga in i portalen för att läsa den och svara kunden.",
      en: "Hi {name}! Someone has sent an enquiry through your campaign page. Sign in to the portal to read it and get back to them."
    },
    button: { sv: "Läs förfrågan", en: "Read the enquiry" },
    note: {
      sv: "Av integritetsskäl står förfrågan aldrig i e-posten. Inte inloggad? Ange din e-postadress i portalen så får du en inloggningslänk.",
      en: "For privacy, the enquiry itself is never in the email. Not signed in? Enter your email address in the portal and you will get a login link."
    }
  }
};

function fill(s, vars) {
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/* Builds one email holding both languages; the client's language comes first. */
export function composeEmail(kind, cfg, { link, name, language, signinUrl, extra }) {
  const c = COPY[kind];
  const order = language === "en" ? ["en", "sv"] : ["sv", "en"];
  const vars = Object.assign({ min: cfg.tokenTtlMinutes, product: cfg.productName, name: name || "", signin: signinUrl }, extra || {});
  const subject = order.map((l) => fill(c.subject[l], vars)).join(" / ");
  const sign = "TAHA Studio Labs, Örebro. " + cfg.tahaEmail;
  const text =
    order
      .map((l) => [fill(c.intro[l], vars), "", fill(c.button[l], vars) + ": " + link, "", fill(c.note[l], vars)].join("\n"))
      .join("\n\n----------\n\n") +
    "\n\n" +
    sign +
    "\n";
  const block = (l) =>
    '<p style="margin:0 0 16px">' +
    escapeHtml(fill(c.intro[l], vars)) +
    "</p>" +
    '<p style="margin:0 0 16px"><a href="' +
    escapeHtml(link) +
    '" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">' +
    escapeHtml(fill(c.button[l], vars)) +
    "</a></p>" +
    '<p style="margin:0;color:#555;font-size:13px">' +
    escapeHtml(fill(c.note[l], vars)) +
    "</p>";
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">' +
    '<p style="font-weight:700;font-size:17px;margin:0 0 20px">' +
    escapeHtml(cfg.productName) +
    "</p>" +
    order.map(block).join('<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">') +
    '<p style="margin:28px 0 0;color:#777;font-size:12px">' +
    escapeHtml(sign) +
    "</p></body></html>";
  return { subject, text, html };
}

/* Notice to Harry when a client submits. Company name and version only, no client content. */
export function composeSubmitNotice(cfg, { company, version, link }) {
  const subject = "Ny inskickning / New intake: " + company + " (v" + version + ")";
  const text =
    company + " har skickat in version " + version + " av sin profil.\n" +
    company + " has submitted version " + version + " of their profile.\n\n" +
    link + "\n";
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">' +
    "<p><b>" + escapeHtml(company) + "</b> har skickat in version " + version + " av sin profil.</p>" +
    "<p><b>" + escapeHtml(company) + "</b> has submitted version " + version + " of their profile.</p>" +
    '<p><a href="' + escapeHtml(link) + '">' + escapeHtml(link) + "</a></p></body></html>";
  return { subject, text, html };
}

/* V2 phase G2a: the client is asked for photos. */
export function composePhotoRequestEmail(cfg, { name, language, count, link }) {
  return composeEmail("photos", cfg, {
    link,
    name,
    language,
    signinUrl: link,
    extra: { count, photoWordSv: count === 1 ? "bild" : "bilder", photoWordEn: count === 1 ? "photo" : "photos" }
  });
}

/* V2 phase G2a: notice to Harry when a client answers a photo request. Company name only. */
export function composePhotoNotice(cfg, { company, open, link }) {
  const left = { sv: open ? open + " kvar att få" : "alla bilder är inne", en: open ? open + " still to come" : "all photos are in" };
  const subject = "Ny bild / New photo: " + company;
  const text =
    company + " har skickat en bild till en bildförfrågan (" + left.sv + ").\n" +
    company + " has sent a photo for a photo request (" + left.en + ").\n\n" +
    link + "\n";
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">' +
    "<p><b>" + escapeHtml(company) + "</b> har skickat en bild till en bildförfrågan (" + escapeHtml(left.sv) + ").</p>" +
    "<p><b>" + escapeHtml(company) + "</b> has sent a photo for a photo request (" + escapeHtml(left.en) + ").</p>" +
    '<p><a href="' + escapeHtml(link) + '">' + escapeHtml(link) + "</a></p></body></html>";
  return { subject, text, html };
}

/* V2 phase G2b: the client has a new enquiry. No content, only a link to the portal. */
export function composeEnquiryEmail(cfg, { name, language, link }) {
  return composeEmail("enquiry", cfg, { link, name, language, signinUrl: link });
}

/* V2 phase G2b: notice to Harry about a new enquiry. Company name only. */
export function composeEnquiryNotice(cfg, { company, link }) {
  const subject = "Ny förfrågan / New enquiry: " + company;
  const text =
    company + " har fått en förfrågan via kampanjsidan.\n" +
    company + " has a new enquiry from the campaign page.\n\n" +
    link + "\n";
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">' +
    "<p><b>" + escapeHtml(company) + "</b> har fått en förfrågan via kampanjsidan.</p>" +
    "<p><b>" + escapeHtml(company) + "</b> has a new enquiry from the campaign page.</p>" +
    '<p><a href="' + escapeHtml(link) + '">' + escapeHtml(link) + "</a></p></body></html>";
  return { subject, text, html };
}

/* V2 Part A: the client asked for review, and Part B: content delivered. No content. */
export function composeReviewEmail(cfg, { name, language, link }) {
  return composeEmail("review", cfg, { link, name, language, signinUrl: link });
}
export function composeDeliveredEmail(cfg, { name, language, link }) {
  return composeEmail("delivered", cfg, { link, name, language, signinUrl: link });
}

/* V2 Part A: notice to Harry when the client approves or asks for changes. Company name and
   round only. */
export function composeDecisionNotice(cfg, { company, round, approved, link }) {
  const what = approved
    ? { sv: "har godkänt kampanjen", en: "has approved the campaign" }
    : { sv: "vill ha ändringar i kampanjen", en: "has asked for changes to the campaign" };
  const subject = (approved ? "Godkänd / Approved: " : "Ändringar / Changes requested: ") + company + " (" + round + ")";
  const text =
    company + " " + what.sv + " (omgång " + round + ").\n" +
    company + " " + what.en + " (round " + round + ").\n\n" +
    link + "\n";
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">' +
    "<p><b>" + escapeHtml(company) + "</b> " + what.sv + " (omgång " + round + ").</p>" +
    "<p><b>" + escapeHtml(company) + "</b> " + what.en + " (round " + round + ").</p>" +
    '<p><a href="' + escapeHtml(link) + '">' + escapeHtml(link) + "</a></p></body></html>";
  return { subject, text, html };
}
