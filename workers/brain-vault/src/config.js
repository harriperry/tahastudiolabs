/* Brain Vault configuration.
   Every setting comes from wrangler.json "vars" (plain values) or from Worker secrets
   (SMTP_PASSWORD, RESEND_API_KEY). Nothing secret is ever written in this file.
   TAHA_EMAIL is the single address used as sender, notification receiver and client
   contact. To move from agborkak@gmail.com to hej@tahastudiolabs.com, change TAHA_EMAIL
   (and ADMIN_EMAILS if Harry signs in with the new address) and redeploy. */

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
  const tahaEmail = String(env.TAHA_EMAIL || "agborkak@gmail.com").trim().toLowerCase();
  const adminEmails = list(env.ADMIN_EMAILS);
  return {
    environment: env.ENVIRONMENT || "production",
    siteOrigin,
    basePath: "/api/vault",
    tahaEmail,
    adminEmails: adminEmails.length ? adminEmails : [tahaEmail],
    fromName: env.MAIL_FROM_NAME || "TAHA Studio Labs",
    productName: env.PRODUCT_NAME || "TAHA Growth Department",
    mailProvider: env.MAIL_PROVIDER || "gmail-smtp",
    smtp: {
      host: env.SMTP_HOST || "smtp.gmail.com",
      port: int(env.SMTP_PORT, 465),
      secure: env.SMTP_SECURE || "on",
      user: String(env.SMTP_USER || tahaEmail).trim(),
      pass: env.SMTP_PASSWORD || ""
    },
    resendKey: env.RESEND_API_KEY || "",
    tokenTtlMinutes: int(env.LOGIN_TOKEN_TTL_MINUTES, 15),
    sessionDays: int(env.SESSION_DAYS, 30),
    rateLimitPerEmailHour: int(env.RATE_LIMIT_PER_EMAIL_HOUR, 5),
    rateLimitPerIpHour: int(env.RATE_LIMIT_PER_IP_HOUR, 20),
    clientHome: env.CLIENT_HOME || "/api/vault/console",
    adminHome: env.ADMIN_HOME || "/api/vault/console",
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
