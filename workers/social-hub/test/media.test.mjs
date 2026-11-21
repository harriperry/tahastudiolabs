/* Image step suite: upload, conversion geometry and the public converted URL. No network. */
import { handle } from "../src/index.js";
import { MAX_EDGE, MAX_RATIO, MIN_RATIO, sniffImage, targetSize } from "../src/media.js";
import { counter, makeEnv, makeSession, seedClient } from "./helpers.mjs";

const { ok, done } = counter();

function fakeR2() {
  const m = new Map();
  return {
    m,
    async put(k, v, o) { m.set(k, { bytes: new Uint8Array(v), o }); },
    async get(k) { const e = m.get(k); return e ? { arrayBuffer: async () => e.bytes.buffer.slice(e.bytes.byteOffset, e.bytes.byteOffset + e.bytes.byteLength) } : null; }
  };
}
function fakeImages(w, h) {
  const log = { transforms: [], outputs: [] };
  return {
    log,
    async info() { return { format: "image/png", width: w, height: h, fileSize: 10 }; },
    input() {
      return {
        transform(t) { log.transforms.push(t); return this; },
        async output(o) { log.outputs.push(o); return { response: () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } }) }; }
      };
    }
  };
}
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const BASE = "https://tahastudiolabs.com/api/vault/social";
const upload = (env, cookie, bytes, origin = "https://tahastudiolabs.com") =>
  handle(new Request(BASE + "/media", { method: "POST", headers: { Cookie: cookie || "", Origin: origin, "Content-Type": "application/octet-stream" }, body: bytes }), env);
const fetchMedia = (env, path) => handle(new Request(BASE + path, { method: "GET" }), env);

/* geometry */
let s = targetSize(1080, 1440);
ok(s.width === 1152 && s.height === 1440, "3:4 portrait is padded out to 4:5 without cropping");
s = targetSize(1080, 1080);
ok(s.width === 1080 && s.height === 1080, "a square is left as it is");
s = targetSize(4000, 3000);
ok(s.width === 1440 && s.height === 1080, "a large image is scaled to 1440 on the long edge");
s = targetSize(3000, 1000);
ok(s.width / s.height <= MAX_RATIO && s.width === 1440, "a very wide image is padded into the 1.91 limit");
s = targetSize(500, 2000);
ok(s.width / s.height >= MIN_RATIO && s.height === 1440, "a very tall image is padded into the 0.8 limit");
let allIn = true;
for (const [w, h] of [[1, 1], [7, 1000], [1000, 7], [1919, 1000], [1921, 1000], [799, 1000], [801, 1000], [1441, 1441], [5000, 4999], [3, 2]]) {
  const t = targetSize(w, h);
  if (!(t.width / t.height >= MIN_RATIO - 1e-9 && t.width / t.height <= MAX_RATIO + 1e-9) || Math.max(t.width, t.height) > MAX_EDGE + 2) allIn = false;
}
ok(allIn, "every output is inside the ratio limits and the size cap, including edge cases");
ok(targetSize(0, 100) === null && targetSize(100, NaN) === null, "bad dimensions are refused");

/* type check */
ok(sniffImage(png) === "image/png", "png is recognised");
ok(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === "image/jpeg", "jpeg is recognised");
ok(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])) === "image/webp", "webp is recognised");
ok(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")) === null, "svg is refused");
ok(sniffImage(new TextEncoder().encode("<html><script>")) === null, "html is refused");

/* upload */
const env = makeEnv({ FILES: fakeR2(), IMAGES: fakeImages(1080, 1440) });
await seedClient(env, "cl_a", "a@example.com");
const admin = await makeSession(env, { role: "admin", email: "admin@example.com" });
const client = await makeSession(env, { role: "client", clientId: "cl_a", email: "a@example.com" });

ok((await upload(env, "", png)).status === 401, "upload needs a session");
ok((await upload(env, client, png)).status === 403, "a client cannot upload");
ok((await upload(env, admin, png, "https://evil.example")).status === 403, "upload from another origin is refused");
ok((await upload(env, admin, new Uint8Array(0))).status === 400, "an empty upload is refused");
ok((await upload(env, admin, new TextEncoder().encode("<svg/>"))).status === 400, "a non-image upload is refused");
ok((await upload(env, admin, new Uint8Array(8 * 1024 * 1024 + 1).fill(0x41))).status === 413, "anything over the size limit is refused before it is read as an image");
const big = new Uint8Array(8 * 1024 * 1024 + 1); big.set(png);
ok((await upload(env, admin, big)).status === 413, "an image over 8 MB is refused");
const up = await upload(env, admin, png);
const upData = await up.json();
ok(up.status === 200 && /^https:\/\/tahastudiolabs\.com\/api\/vault\/social\/media\/[A-Za-z0-9_-]{20,}\.jpg$/.test(upData.url), "an admin upload returns the public converted URL");
const id = upData.url.split("/media/")[1].replace(".jpg", "");
ok(env.FILES.m.has("social-media/" + id), "the original is stored under the social-media prefix");
const au = await env.DB.prepare("SELECT actor, detail FROM social_audit WHERE action = 'media_uploaded'").first();
ok(au && au.actor === "admin@example.com" && !au.detail.includes("iVBOR"), "the upload is audited without file content");

/* serving */
const g = await fetchMedia(env, "/media/" + id + ".jpg");
const gb = new Uint8Array(await g.arrayBuffer());
ok(g.status === 200 && g.headers.get("Content-Type") === "image/jpeg" && gb[0] === 0xff, "the converted image is served as jpeg with no login");
ok(/max-age/.test(g.headers.get("Cache-Control")) && g.headers.get("X-Content-Type-Options") === "nosniff", "it is cacheable and sent with nosniff");
const t0 = env.IMAGES.log.transforms[0];
ok(t0.width === 1152 && t0.height === 1440 && t0.fit === "pad" && t0.background === "#000000", "the converter pads a 3:4 original to 4:5 on black");
ok(env.IMAGES.log.outputs[0].format === "image/jpeg", "the output format is jpeg");
ok((await fetchMedia(env, "/media/" + id)).status === 200, "the id also works without the extension");
ok((await fetchMedia(env, "/media/AAAAAAAAAAAAAAAAAAAAAAAA.jpg")).status === 404, "an unknown id is not found");
ok((await fetchMedia(env, "/media/..%2F..%2Fsecret.jpg")).status === 404, "a path traversal id is refused");
ok((await fetchMedia(env, "/media/short.jpg")).status === 404, "a malformed id is refused");
await env.FILES.put("other/" + id, png, {});
ok((await fetchMedia(env, "/media/" + id + "x.jpg")).status === 404, "only the media prefix can be read");
const envNoImg = makeEnv({ FILES: env.FILES });
ok((await fetchMedia(envNoImg, "/media/" + id + ".jpg")).status === 503, "without the Images binding nothing unconverted is served");
const wide = makeEnv({ FILES: env.FILES, IMAGES: fakeImages(3000, 1000), SOCIAL_PAD_COLOR: "#ffffff" });
await fetchMedia(wide, "/media/" + id + ".jpg");
const t1 = wide.IMAGES.log.transforms[0];
ok(t1.width === 1440 && t1.height <= 754 + 1 && t1.background === "#ffffff", "a wide original is padded into range and the pad colour is configurable");

/* the URL works for posts */
const body = JSON.stringify({ clientId: "cl_a", platform: "instagram", body: "hello", mediaUrl: upData.url });
const v = await handle(new Request(BASE + "/versions", { method: "POST", headers: { Cookie: admin, Origin: "https://tahastudiolabs.com", "Content-Type": "application/json" }, body }), env);
ok(v.status === 200, "a post can use the converted URL as its image");

done();
