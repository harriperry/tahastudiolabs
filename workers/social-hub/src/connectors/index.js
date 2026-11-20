/* Connector registry. The mock is for tests. Meta (meta, facebook, instagram) arrives in Phase 2; LinkedIn and
   TikTok follow in later approved phases. A connector runs only when listed in SOCIAL_CONNECTORS. */
import { metaConnect, metaFacebook, metaInstagram } from "./meta.js";
import { mock } from "./mock.js";

const ALL = { mock, meta: metaConnect, facebook: metaFacebook, instagram: metaInstagram };

export function getConnector(env, platform) {
  const enabled = String(env.SOCIAL_CONNECTORS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!enabled.includes(platform)) return null;
  if (platform === "mock" && env.ENVIRONMENT === "production" && env.SOCIAL_ALLOW_MOCK !== "on") return null;
  return ALL[platform] || null;
}
