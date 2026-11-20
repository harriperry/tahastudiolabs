/* Mock connector. Talks to nothing. It exists so every Phase 1 behaviour (OAuth state, token
   storage, scheduling, retries, idempotency, kill switch) can be tested with no Meta, LinkedIn
   or TikTok app. It is refused in production unless SOCIAL_ALLOW_MOCK is "on".

   Connector contract (every real connector must follow it):
     authUrl({ state, challenge, redirectUri }) -> string
     exchangeCode({ code, verifier, redirectUri }) -> { externalRef, displayName, accessToken, refreshToken?, expiresAt? }
     publish({ accessToken, body, idempotencyKey, externalRef }) -> { externalId, url }
   publish may throw an error with retryable = true ONLY when it is certain nothing was sent
   (for example a 429 or a failure before the request left). Any doubt means retryable = false. */
export const sent = [];

function fail(message, retryable) {
  const e = new Error(message);
  e.retryable = retryable;
  return e;
}

export const mock = {
  platform: "mock",
  authUrl({ state, challenge, redirectUri }) {
    const u = new URL("https://mock.invalid/oauth/authorize");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("redirect_uri", redirectUri);
    return u.toString();
  },
  async exchangeCode({ code, verifier }) {
    if (!verifier) throw fail("missing verifier", false);
    if (!/^good-/.test(code || "")) throw fail("code rejected", false);
    const ref = code.slice(5) || "page1";
    return {
      externalRef: ref,
      displayName: "Mock page " + ref,
      accessToken: "mock-access-" + ref + "-" + Math.random().toString(36).slice(2),
      refreshToken: "mock-refresh-" + ref,
      expiresAt: Date.now() + 60 * 24 * 3600 * 1000
    };
  },
  async publish({ accessToken, body, idempotencyKey, externalRef }) {
    if (!accessToken) throw fail("no token", false);
    if (body.includes("[fail-temp]") && !body.includes("[fail-temp-done]")) throw fail("rate limited", true);
    if (body.includes("[fail-permanent]")) throw fail("rejected by platform", false);
    sent.push({ idempotencyKey, externalRef, body });
    return { externalId: "mock_post_" + sent.length, url: "https://mock.invalid/p/" + sent.length };
  }
};
