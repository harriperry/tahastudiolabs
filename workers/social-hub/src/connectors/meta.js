/* Meta connectors: Facebook Pages and Instagram (Instagram API with Facebook Login).
   Three registry entries share this file:
     "meta"      the connect flow (authUrl, exchangeCode); returns every Page the person granted
                 plus the Instagram professional account linked to each Page.
     "facebook"  publishes to a Facebook Page (text, link, or one photo).
     "instagram" publishes one image to an Instagram professional account (container, then publish).
   Every authenticated call carries appsecret_proof. The app secret and tokens are never logged and
   never put in an error message. Page tokens come from a long-lived user token and do not expire.
   Meta documentation is the reference for field names: re-check them at the first live test. */

const GRAPH = "https://graph.facebook.com";
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish"
];
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

function version(env) {
  return (env && env.META_GRAPH_VERSION) || "v25.0";
}

function fail(message, flags = {}) {
  const e = new Error(String(message).slice(0, 200));
  e.retryable = flags.retryable === true;
  e.unknown = flags.unknown === true;
  e.tokenInvalid = flags.tokenInvalid === true;
  return e;
}

async function proof(token, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Classifies a Graph error so the queue knows whether anything could have been published. */
function graphError(status, err, method) {
  const code = err && err.code;
  const sub = err && err.error_subcode;
  const msg = "meta " + (code || status) + (sub ? "/" + sub : "") + ": " + String((err && err.message) || "request failed");
  if (code === 190) return fail(msg, { tokenInvalid: true });
  if (RATE_LIMIT_CODES.has(code)) return fail(msg, { retryable: true });
  if (sub === 2207042) return fail("instagram daily publishing limit reached", {});
  if (status >= 500) return fail(msg, method === "GET" ? { retryable: true } : { unknown: true });
  return fail(msg, {});
}

async function graph(env, method, path, params = {}, token = null) {
  const p = { ...params };
  if (token) {
    p.access_token = token;
    if (env.META_APP_SECRET) p.appsecret_proof = await proof(token, env.META_APP_SECRET);
  }
  const url = new URL(GRAPH + "/" + version(env) + "/" + path);
  let init = { method, headers: { Accept: "application/json" } };
  if (method === "GET") {
    for (const [k, v] of Object.entries(p)) url.searchParams.set(k, String(v));
  } else {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) form.set(k, String(v));
    init.body = form;
  }
  let res;
  try {
    res = await fetch(url.toString(), init);
  } catch (e) {
    /* A write that dies on the wire may still have reached Meta. */
    throw fail("network error", method === "GET" ? { retryable: true } : { unknown: true });
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok || (data && data.error)) throw graphError(res.status, data && data.error, method);
  return data || {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const metaConnect = {
  platform: "meta",
  authUrl({ state, redirectUri, env }) {
    const u = new URL("https://www.facebook.com/" + version(env) + "/dialog/oauth");
    u.searchParams.set("client_id", env.META_APP_ID || "");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("response_type", "code");
    if (env.META_CONFIG_ID) u.searchParams.set("config_id", env.META_CONFIG_ID);
    else u.searchParams.set("scope", SCOPES.join(","));
    return u.toString();
  },
  async exchangeCode({ code, redirectUri, env }) {
    if (!env.META_APP_ID || !env.META_APP_SECRET) throw fail("meta app not configured");
    const short = await graph(env, "GET", "oauth/access_token", {
      client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code
    });
    const long = await graph(env, "GET", "oauth/access_token", {
      grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET,
      fb_exchange_token: short.access_token
    });
    const me = await graph(env, "GET", "me", { fields: "id" }, long.access_token);
    const pages = await graph(env, "GET", "me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username}", limit: 25
    }, long.access_token);
    const accounts = [];
    for (const pg of pages.data || []) {
      if (!pg.id || !pg.access_token) continue;
      accounts.push({ platform: "facebook", externalRef: String(pg.id), displayName: String(pg.name || pg.id), accessToken: pg.access_token });
      const ig = pg.instagram_business_account;
      if (ig && ig.id) {
        accounts.push({ platform: "instagram", externalRef: String(ig.id), displayName: "@" + String(ig.username || ig.id), accessToken: pg.access_token });
      }
    }
    if (!accounts.length) throw fail("no pages granted");
    return { providerUserId: String(me.id), accounts };
  }
};

export const metaFacebook = {
  platform: "facebook",
  async publish({ accessToken, body, link, mediaUrl, externalRef, env }) {
    let r;
    if (mediaUrl) {
      r = await graph(env, "POST", externalRef + "/photos", { url: mediaUrl, caption: body, published: "true" }, accessToken);
    } else {
      const params = { message: body };
      if (link) params.link = link;
      r = await graph(env, "POST", externalRef + "/feed", params, accessToken);
    }
    const id = r.post_id || r.id;
    if (!id) throw fail("meta returned no post id", { unknown: true });
    return { externalId: String(id), url: "https://www.facebook.com/" + id };
  }
};

export const metaInstagram = {
  platform: "instagram",
  async publish({ accessToken, body, mediaUrl, externalRef, env }) {
    if (!mediaUrl) throw fail("instagram needs an image");
    /* Our own check against the platform's rolling limit. A failed check never blocks a post. */
    try {
      const lim = await graph(env, "GET", externalRef + "/content_publishing_limit", { fields: "quota_usage" }, accessToken);
      const used = lim.data && lim.data[0] && lim.data[0].quota_usage;
      const cap = parseInt(env.SOCIAL_IG_CAP, 10) || 25;
      if (typeof used === "number" && used >= cap) throw fail("instagram daily limit reached", {});
    } catch (e) {
      if (e && e.message === "instagram daily limit reached") throw e;
    }
    /* Step 1: a container. Nothing is public yet, so every failure here is safe to retry. */
    let container;
    try {
      container = await graph(env, "POST", externalRef + "/media", { image_url: mediaUrl, caption: body }, accessToken);
    } catch (e) {
      if (e.unknown) { e.unknown = false; e.retryable = true; }
      throw e;
    }
    const wait = env.META_POLL_MS === undefined ? 2000 : parseInt(env.META_POLL_MS, 10) || 0;
    let ready = false;
    for (let i = 0; i < 8; i++) {
      const st = await graph(env, "GET", container.id, { fields: "status_code" }, accessToken);
      if (st.status_code === "FINISHED") { ready = true; break; }
      if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw fail("instagram could not process the image", {});
      if (wait) await sleep(wait);
    }
    if (!ready) throw fail("instagram image still processing", { retryable: true });
    /* Step 2: publish. From here on a lost answer means the post may exist. */
    const pub = await graph(env, "POST", externalRef + "/media_publish", { creation_id: container.id }, accessToken);
    if (!pub.id) throw fail("meta returned no media id", { unknown: true });
    let url = null;
    try {
      const m = await graph(env, "GET", pub.id, { fields: "permalink" }, accessToken);
      url = m.permalink || null;
    } catch (e) {}
    return { externalId: String(pub.id), url };
  }
};

/* Meta calls these two URLs with a signed_request. Returns { userId } or null. */
export async function parseSignedRequest(signed, secret) {
  if (!secret || typeof signed !== "string" || signed.indexOf(".") < 1) return null;
  const [sig, payload] = signed.split(".");
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (sig.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
    if (!ok) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4)));
    return json && json.user_id ? { userId: String(json.user_id) } : null;
  } catch (e) {
    return null;
  }
}

