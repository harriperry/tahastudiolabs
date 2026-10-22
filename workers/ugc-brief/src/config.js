/* Share Your Brief configuration. Plain values come from wrangler.json "vars"; secrets
   (RESEND_API_KEY, LINK_SECRET) are Worker secrets and never appear in this repo. */

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

/* Usage rights follow the packages brief. Revision rounds per package are an ASSUMPTION
   (the brief lists "one revision round / two revision rounds / priority revisions" without
   saying which package gets which): change them here, nowhere else. */
export const PACKAGES = {
  starter: {
    label: "Starter",
    usage: "organic social media usage and 30-day paid advertising usage",
    usageShort: "Organic social media usage plus 30-day paid advertising usage",
    revisionRounds: 1,
    revisionLabel: "one revision round"
  },
  growth: {
    label: "Growth",
    usage: "60-day paid advertising usage",
    usageShort: "60-day paid advertising usage",
    revisionRounds: 2,
    revisionLabel: "two revision rounds"
  },
  scale: {
    label: "Scale",
    usage: "90-day paid advertising usage",
    usageShort: "90-day paid advertising usage",
    revisionRounds: 3,
    revisionLabel: "three revision rounds"
  },
  retainer: {
    label: "Retainer",
    usage: "flexible monthly usage rights, including paid advertising usage",
    usageShort: "Flexible monthly usage rights, including paid advertising usage",
    revisionRounds: 2,
    revisionLabel: "two revisions per video and priority delivery"
  }
};

export const EXTRA_USAGE_NOTE =
  "Paid ads, whitelisting and extended usage beyond the included period are priced separately and agreed in writing before delivery.";

export const CHANGE_ROUNDS_INCLUDED = 2;
export const REVISION_DAYS = 7;

export const GOALS = {
  sales: { label: "Sales", phrase: "drive sales" },
  leads: { label: "Leads", phrase: "generate leads" },
  awareness: { label: "Awareness", phrase: "build awareness" },
  app_installs: { label: "App installs", phrase: "get more app installs" },
  sign_ups: { label: "Sign-ups", phrase: "get more sign-ups" },
  other: { label: "Other", phrase: "" }
};

export const PLATFORMS = {
  tiktok: "TikTok",
  reels: "Instagram Reels",
  meta_ads: "Meta Ads",
  shorts: "YouTube Shorts",
  other: "Other"
};

export const LENGTHS = { "15_30": "15 to 30 seconds", "30_45": "30 to 45 seconds" };

/* One list drives the form in the browser, the server side validation, the admin view and the
   alert email. group is the form section; showIf hides a field until another has a value. */
export const FIELDS = [
  { key: "brand", label: "Client or brand name", type: "text", required: true, max: 120, group: "About you" },
  { key: "contact_name", label: "Contact person", type: "text", required: true, max: 120, group: "About you" },
  { key: "email", label: "Email address", type: "email", required: true, max: 200, group: "About you", help: "Your private project link is sent here." },
  { key: "website", label: "Website", type: "text", required: false, max: 300, group: "About you" },
  { key: "socials", label: "Social media links", type: "textarea", required: false, max: 600, group: "About you" },

  { key: "product", label: "Product or service", type: "textarea", required: true, max: 800, group: "The campaign" },
  { key: "goal", label: "Campaign goal", type: "select", required: true, group: "The campaign", options: Object.fromEntries(Object.entries(GOALS).map(([k, v]) => [k, v.label])) },
  { key: "goal_other", label: "Describe the goal", type: "text", required: true, max: 160, group: "The campaign", showIf: { key: "goal", value: "other" } },
  { key: "audience", label: "Target audience", type: "textarea", required: true, max: 800, group: "The campaign" },
  { key: "problem", label: "Main problem the product solves", type: "textarea", required: true, max: 800, group: "The campaign" },
  { key: "benefits", label: "Key benefits or unique selling points", type: "textarea", required: true, max: 1000, group: "The campaign" },

  { key: "platform", label: "Preferred platform", type: "select", required: true, group: "Format", options: PLATFORMS },
  { key: "platform_other", label: "Which platform?", type: "text", required: true, max: 120, group: "Format", showIf: { key: "platform", value: "other" } },
  { key: "length", label: "Preferred video length", type: "select", required: true, group: "Format", options: LENGTHS },
  { key: "delivery_date", label: "Desired delivery date", type: "date", required: false, group: "Format" },

  { key: "guidelines", label: "Brand guidelines, tone of voice, colors, fonts or content examples", type: "textarea", required: false, max: 1200, group: "Your brand" },
  { key: "claims", label: "Required claims, disclaimers, restricted words or compliance notes", type: "textarea", required: false, max: 1200, group: "Your brand" },

  { key: "package", label: "Package", type: "package", required: true, group: "Package" },
  { key: "notes", label: "Anything else we should know", type: "textarea", required: false, max: 1500, group: "Package" }
];

export function getConfig(env) {
  const siteOrigin = (env.SITE_ORIGIN || "https://ugc.tahastudiolabs.com").replace(/\/+$/, "");
  const tahaEmail = String(env.TAHA_EMAIL || "hej@tahastudiolabs.com").trim().toLowerCase();
  const adminEmails = list(env.ADMIN_EMAILS);
  return {
    environment: env.ENVIRONMENT || "production",
    siteOrigin,
    tahaEmail,
    adminEmails: adminEmails.length ? adminEmails : [tahaEmail],
    fromName: env.MAIL_FROM_NAME || "TAHA Studio Labs",
    mailProvider: env.MAIL_PROVIDER || "resend",
    resendKey: env.RESEND_API_KEY || "",
    linkSecret: env.LINK_SECRET || "",
    privacyUrl: env.PRIVACY_URL || "https://tahastudiolabs.com/privacy.html",
    tokenTtlMinutes: int(env.LOGIN_TOKEN_TTL_MINUTES, 15),
    sessionDays: int(env.SESSION_DAYS, 14),
    submitsPerIpHour: int(env.SUBMITS_PER_IP_HOUR, 6),
    linkRequestsPerEmailHour: int(env.LINK_REQUESTS_PER_EMAIL_HOUR, 4),
    clientBase: siteOrigin + "/brief/",
    studioBase: siteOrigin + "/brief/studio"
  };
}

export const ADMIN_COOKIE = "__Host-ugc_admin";

export const STATUSES = ["draft", "brief_received", "script_review", "changes_requested", "approved", "in_production", "delivered", "closed"];

/* Which of the three client facing steps a status belongs to. */
export function stepOf(status) {
  if (status === "draft" || status === "brief_received") return 1;
  if (status === "script_review" || status === "changes_requested" || status === "approved") return 2;
  return 3;
}

export const STATUS_LABELS = {
  draft: "Sending your brief",
  brief_received: "Brief received",
  script_review: "Hooks and script ready for your approval",
  changes_requested: "Changes requested, updated version coming",
  approved: "Approved, production starting",
  in_production: "In production",
  delivered: "Delivered",
  closed: "Closed"
};
