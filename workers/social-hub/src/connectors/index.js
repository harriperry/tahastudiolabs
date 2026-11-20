/* Connector registry. Phase 1 ships only the mock. Real connectors (Meta, LinkedIn, TikTok...)
   arrive in later approved phases and are listed in SOCIAL_CONNECTORS once enabled. */
import { mock } from "./mock.js";

const ALL = { mock };

export function getConnector(env, platform) {
  const enabled = String(env.SOCIAL_CONNECTORS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!enabled.includes(platform)) return null;
  if (platform === "mock" && env.ENVIRONMENT === "production" && env.SOCIAL_ALLOW_MOCK !== "on") return null;
  return ALL[platform] || null;
}
