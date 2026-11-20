/* Notification email for the approval flow. Sends through Resend as hej@tahastudiolabs.com,
   using its own secret (RESEND_API_KEY on social-hub), so the Vault is never touched.
   Rules: always Swedish and English, never any post content (only names, counts and a link),
   never an em-dash, and a failed or missing send never blocks the work that triggered it. */
import { escapeHtml, noDashes } from "./util.js";

const DEFAULT_FROM = "TAHA Studio Labs <hej@tahastudiolabs.com>";

export async function sendMail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "no_key" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM || DEFAULT_FROM,
        to: [to],
        reply_to: "hej@tahastudiolabs.com",
        subject: noDashes(subject),
        text: noDashes(text),
        html: noDashes(html)
      })
    });
    return res.ok ? { sent: true } : { sent: false, reason: "provider_" + res.status };
  } catch (e) {
    return { sent: false, reason: "network" };
  }
}

const COPY = {
  proposal: {
    subject: { sv: "Nya inlägg att granska", en: "New posts to review" },
    intro: {
      sv: "Hej {name}, TAHA Studio Labs har förberett {n} inlägg åt dig. Granska dem och godkänn dem du vill publicera. Inget publiceras förrän du har godkänt.",
      en: "Hello {name}, TAHA Studio Labs has prepared {n} post(s) for you. Review them and approve the ones you want published. Nothing is published until you approve."
    },
    button: { sv: "Granska inläggen", en: "Review the posts" },
    note: {
      sv: "Om du blir ombedd att logga in, använd din vanliga inloggningslänk.",
      en: "If you are asked to sign in, use your usual login link."
    }
  }
};

function fill(s, vars) {
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? "" : String(vars[k])));
}

export function composeProposalNotice({ name, language, count, link }) {
  const c = COPY.proposal;
  const order = language === "en" ? ["en", "sv"] : ["sv", "en"];
  const vars = { name: name || "", n: count };
  const subject = noDashes(order.map((l) => c.subject[l]).join(" / "));
  const sign = "TAHA Studio Labs, Örebro. hej@tahastudiolabs.com";
  const text =
    order.map((l) => [fill(c.intro[l], vars), "", c.button[l] + ": " + link, "", c.note[l]].join("\n")).join("\n\n----------\n\n") +
    "\n\n" + sign + "\n";
  const block = (l) =>
    '<p style="margin:0 0 16px">' + escapeHtml(fill(c.intro[l], vars)) + "</p>" +
    '<p style="margin:0 0 16px"><a href="' + escapeHtml(link) + '" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">' + escapeHtml(c.button[l]) + "</a></p>" +
    '<p style="margin:0;color:#555;font-size:13px">' + escapeHtml(c.note[l]) + "</p>";
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">' +
    '<p style="font-weight:700;font-size:17px;margin:0 0 20px">TAHA Studio Labs</p>' +
    order.map(block).join('<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">') +
    '<p style="margin:28px 0 0;color:#777;font-size:12px">' + escapeHtml(sign) + "</p></body></html>";
  return { subject, text: noDashes(text), html: noDashes(html) };
}

/* Notice to the team when a client decides. Company name and decision only, never post text. */
export function composeDecisionNotice({ company, decision, link }) {
  const sv = { approved: "godkände ett inlägg", changes_requested: "bad om ändringar i ett inlägg", rejected: "avvisade ett inlägg" };
  const en = { approved: "approved a post", changes_requested: "requested changes to a post", rejected: "rejected a post" };
  const subject = noDashes("Beslut / Decision: " + company);
  const text = company + " " + (sv[decision] || "fattade ett beslut") + ".\n" + company + " " + (en[decision] || "made a decision") + ".\n\n" + link + "\n";
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;max-width:560px;margin:0 auto;padding:24px">' +
    "<p><b>" + escapeHtml(company) + "</b> " + escapeHtml(sv[decision] || "fattade ett beslut") + ".</p>" +
    "<p><b>" + escapeHtml(company) + "</b> " + escapeHtml(en[decision] || "made a decision") + ".</p>" +
    '<p><a href="' + escapeHtml(link) + '">' + escapeHtml(link) + "</a></p></body></html>";
  return { subject, text: noDashes(text), html: noDashes(html) };
}
