/* Outgoing email through Resend, always from hej@tahastudiolabs.com.
   MAIL_PROVIDER=log is for local development only and is refused in production.
   Client emails carry only a name, a button and a private link. The brief alert goes to
   Harry's own inbox and carries the full brief. No email is ever sent to a client about
   anything except the private link, unless Harry ticks "Notify client" on an action. */
import { noDashes, escapeHtml } from "./util.js";
import { FIELDS, GOALS, PACKAGES, PLATFORMS, LENGTHS } from "./config.js";

const devMails = [];
export function devMailList() {
  return devMails;
}

export async function sendMail(cfg, env, { to, subject, text, html }) {
  subject = noDashes(subject);
  text = noDashes(text);
  html = noDashes(html);
  if (cfg.mailProvider === "log") {
    if (cfg.environment === "production") throw new Error("MAIL_PROVIDER=log is not allowed in production");
    devMails.push({ to, subject, text, html });
    if (devMails.length > 50) devMails.shift();
    console.log("[dev mail] to=" + to + " subject=" + subject);
    return { ok: true, provider: "log" };
  }
  if (cfg.mailProvider === "resend") {
    if (!cfg.resendKey) throw new Error("RESEND_API_KEY is not set");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.resendKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.fromName + " <" + cfg.tahaEmail + ">",
        to: [to],
        reply_to: cfg.tahaEmail,
        subject,
        text,
        html
      })
    });
    if (!res.ok) throw new Error("Resend failed with " + res.status);
    return { ok: true, provider: "resend" };
  }
  throw new Error("Unknown MAIL_PROVIDER");
}

const SHELL_OPEN =
  '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#14161C;max-width:580px;margin:0 auto;padding:24px">';
const SHELL_CLOSE = "</body></html>";

function button(link, label) {
  return (
    '<p style="margin:20px 0"><a href="' +
    escapeHtml(link) +
    '" style="display:inline-block;background:#14161C;color:#F6F1E7;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">' +
    escapeHtml(label) +
    "</a></p>"
  );
}

function sign(cfg) {
  return "TAHA Studio Labs, Örebro. " + cfg.tahaEmail;
}

/* The one email every client gets: the private dashboard link. */
export function composeClientLink(cfg, { contactName, brand, link, again }) {
  const subject = again ? "Your private project link: " + brand : "Your AI UGC project: " + brand;
  const intro = again
    ? "Here is your private link to the " + brand + " project dashboard."
    : "Thank you for sharing your brief for " + brand + ". Your project now lives in your private dashboard.";
  const body =
    "In the dashboard you can see the status, approve your hooks and script, message me, and download your videos when they are ready. Please keep this link, it is how you get back in.";
  const text = "Hi " + contactName + ",\n\n" + intro + "\n\n" + body + "\n\nOpen your dashboard: " + link + "\n\n" + sign(cfg) + "\n";
  const html =
    SHELL_OPEN +
    '<p style="font-weight:700;font-size:17px;margin:0 0 18px">TAHA Studio Labs AI UGC</p>' +
    "<p>Hi " + escapeHtml(contactName) + ",</p><p>" + escapeHtml(intro) + "</p><p>" + escapeHtml(body) + "</p>" +
    button(link, "Open your dashboard") +
    '<p style="color:#5E6470;font-size:12px;margin-top:28px">' + escapeHtml(sign(cfg)) + "</p>" +
    SHELL_CLOSE;
  return { subject, text, html };
}

/* Optional nudge, only when Harry ticks Notify client. No content, only a pointer. */
export function composeNudge(cfg, { contactName, brand, link, what }) {
  const subject = "Something is waiting in your dashboard: " + brand;
  const text = "Hi " + contactName + ",\n\n" + what + "\n\nOpen your dashboard: " + link + "\n\n" + sign(cfg) + "\n";
  const html =
    SHELL_OPEN + "<p>Hi " + escapeHtml(contactName) + ",</p><p>" + escapeHtml(what) + "</p>" + button(link, "Open your dashboard") +
    '<p style="color:#5E6470;font-size:12px;margin-top:28px">' + escapeHtml(sign(cfg)) + "</p>" + SHELL_CLOSE;
  return { subject, text, html };
}

export function composeAdminLogin(cfg, { link }) {
  const subject = "Your Share Your Brief studio sign-in link";
  const text =
    "Click to sign in to the Share Your Brief studio. The link works once and is valid for " + cfg.tokenTtlMinutes + " minutes.\n\n" + link +
    "\n\nIf you did not ask for it, ignore this email.\n";
  const html =
    SHELL_OPEN + "<p>Sign in to the Share Your Brief studio. The link works once and is valid for " + cfg.tokenTtlMinutes + " minutes.</p>" +
    button(link, "Sign in") + '<p style="color:#5E6470;font-size:13px">If you did not ask for it, ignore this email.</p>' + SHELL_CLOSE;
  return { subject, text, html };
}

function labelOf(f, value) {
  if (f.options) return f.options[value] || value;
  if (f.type === "package") return PACKAGES[value] ? PACKAGES[value].label : value;
  return value;
}

/* Rows of "label: answer" for a stored brief, in form order. */
export function briefRows(brief) {
  const rows = [];
  for (const f of FIELDS) {
    const v = brief[f.key];
    if (v == null || v === "") continue;
    rows.push([f.label, labelOf(f, v)]);
  }
  return rows;
}

/* Full brief to Harry's own inbox, with asset links that open inside the studio. */
export function composeAdminBrief(cfg, { project, brief, files, adminLink }) {
  const subject = "New AI UGC Brief: " + project.brand;
  const rows = briefRows(brief);
  rows.push(["Submitted", project.created_at]);
  const fileLines = files.map((f) => f.name + " (" + Math.round(f.size / 1024) + " KB)");
  const text =
    "New brief from " + project.brand + " (" + project.contact_name + ", " + project.email + ").\n\n" +
    rows.map(([k, v]) => k + ": " + v).join("\n\n") +
    "\n\nUploaded assets (" + files.length + "):\n" + (fileLines.length ? fileLines.map((l) => "- " + l).join("\n") : "- none") +
    "\n\nOpen in the studio (assets download there): " + adminLink + "\n";
  const html =
    SHELL_OPEN +
    '<p style="font-weight:700;font-size:17px;margin:0 0 14px">New AI UGC Brief: ' + escapeHtml(project.brand) + "</p>" +
    '<table style="border-collapse:collapse;width:100%">' +
    rows.map(([k, v]) => '<tr><td style="vertical-align:top;padding:6px 10px 6px 0;color:#5E6470;width:34%">' + escapeHtml(k) + '</td><td style="padding:6px 0;white-space:pre-wrap">' + escapeHtml(v) + "</td></tr>").join("") +
    "</table>" +
    "<p><b>Uploaded assets (" + files.length + ")</b></p>" +
    (fileLines.length ? "<ul>" + fileLines.map((l) => "<li>" + escapeHtml(l) + "</li>").join("") + "</ul>" : "<p>None</p>") +
    button(adminLink, "Open in the studio") + SHELL_CLOSE;
  return { subject, text, html };
}

/* Short internal alert for client actions. Brand and event only. */
export function composeAdminEvent(cfg, { brand, what, adminLink }) {
  const subject = brand + ": " + what;
  const text = brand + ": " + what + "\n\n" + adminLink + "\n";
  const html = SHELL_OPEN + "<p><b>" + escapeHtml(brand) + "</b>: " + escapeHtml(what) + "</p>" + button(adminLink, "Open in the studio") + SHELL_CLOSE;
  return { subject, text, html };
}

export { GOALS, PLATFORMS, LENGTHS };
