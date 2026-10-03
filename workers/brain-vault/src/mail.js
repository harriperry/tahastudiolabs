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
  }
};

function fill(s, vars) {
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

/* Builds one email holding both languages; the client's language comes first. */
export function composeEmail(kind, cfg, { link, name, language, signinUrl }) {
  const c = COPY[kind];
  const order = language === "en" ? ["en", "sv"] : ["sv", "en"];
  const vars = { min: cfg.tokenTtlMinutes, product: cfg.productName, name: name || "", signin: signinUrl };
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
