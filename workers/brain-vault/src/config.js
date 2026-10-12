/* Brain Vault configuration.
   Every setting comes from wrangler.json "vars" (plain values) or from Worker secrets
   (SMTP_PASSWORD, RESEND_API_KEY). Nothing secret is ever written in this file.
   TAHA_EMAIL is the sender and the contact address clients see (hej@tahastudiolabs.com
   since Part F, 12 Oct 2026). NOTIFY_EMAIL is where Harry's notices go; it defaults to
   TAHA_EMAIL but is set to his Gmail inbox, because Gmail can hide mail that arrives
   "from" one of its own send-as addresses. */

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function getConfig(env) {
  const siteOrigin = (env.SITE_ORIGIN || "https://tahastudiolabs.com").replace(/\/+$/, "");
  const tahaEmail = String(env.TAHA_EMAIL || "hej@tahastudiolabs.com").trim().toLowerCase();
  const adminEmails = list(env.ADMIN_EMAILS);
  return {
    environment: env.ENVIRONMENT || "production",
    siteOrigin,
    basePath: "/api/vault",
    tahaEmail,
    notifyEmail: String(env.NOTIFY_EMAIL || tahaEmail).trim().toLowerCase(),
    adminEmails: adminEmails.length ? adminEmails : [tahaEmail],
    fromName: env.MAIL_FROM_NAME || "TAHA Studio Labs",
    productName: env.PRODUCT_NAME || "TAHA Studio Labs Growth Department",
    consentVersion: env.CONSENT_VERSION || "c-1",
    retentionMonths: int(env.RETENTION_MONTHS, 6),
    privacyUrl: env.PRIVACY_URL || "https://tahastudiolabs.com/privacy.html",
    mailProvider: env.MAIL_PROVIDER || "gmail-smtp",
    smtp: {
      host: env.SMTP_HOST || "smtp.gmail.com",
      port: int(env.SMTP_PORT, 465),
      secure: env.SMTP_SECURE || "on",
      user: String(env.SMTP_USER || tahaEmail).trim(),
      pass: String(env.SMTP_PASSWORD || "").replace(/\s+/g, "")
    },
    resendKey: env.RESEND_API_KEY || "",
    tokenTtlMinutes: int(env.LOGIN_TOKEN_TTL_MINUTES, 15),
    sessionDays: int(env.SESSION_DAYS, 30),
    rateLimitPerEmailHour: int(env.RATE_LIMIT_PER_EMAIL_HOUR, 5),
    rateLimitPerIpHour: int(env.RATE_LIMIT_PER_IP_HOUR, 20),
    clientHome: env.CLIENT_HOME || "/grow/",
    adminHome: env.ADMIN_HOME || "/api/vault/console",
    /* Where the "new intake" email sends Harry: the Growth Clients panel in ScriptForge. */
    growthPanelUrl: siteOrigin + (env.GROWTH_PANEL_PATH || "/scriptforge/#growth"),
    bridgeOn: String(env.SCRIPTFORGE_ADMIN_BRIDGE || "on").toLowerCase() === "on",
    scriptforgeMeUrl: env.SCRIPTFORGE_ME_URL || siteOrigin + "/api/me"
  };
}

export const SESSION_COOKIE = "__Host-tv_session";

export const STATUSES = [
  "invited",
  "profile_in_progress",
  "submitted",
  "brain_ready",
  "campaign_in_production",
  "campaign_delivered"
];

/* Status labels the client sees, in both languages (spec section 4). */
export const STATUS_LABELS = {
  invited: { sv: "Inbjuden", en: "Invited" },
  profile_in_progress: { sv: "Profilen pågår", en: "Profile in progress" },
  submitted: { sv: "Inskickad", en: "Submitted" },
  brain_ready: { sv: "Din strategi är klar", en: "Your strategy is ready" },
  campaign_in_production: { sv: "Kampanjen produceras", en: "Campaign in production" },
  campaign_delivered: { sv: "Kampanjen är levererad", en: "Campaign delivered" }
};
