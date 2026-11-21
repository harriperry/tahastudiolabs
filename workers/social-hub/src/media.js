/* Image step for social-hub. Admin uploads an original to R2 under social-media/, and a public
   URL on our own domain serves it converted for the platforms: JPEG, never wider than 1440 px and
   always inside Instagram's allowed ratio (0.8 to 1.91). Out-of-range images are padded, never
   cropped. The URL holds a random id, so only people we gave the link to can fetch it, and the
   file is only readable through this converter. Converting uses the Cloudflare Images binding. */
import { randomToken } from "./util.js";

export const MEDIA_PREFIX = "social-media/";
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MIN_RATIO = 0.8;
export const MAX_RATIO = 1.91;
export const MAX_EDGE = 1440;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/* Pure geometry: the output size for a source image. */
export function targetSize(width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  let w = width;
  let h = height;
  const ratio = w / h;
  if (ratio < MIN_RATIO) w = Math.ceil(h * MIN_RATIO);
  else if (ratio > MAX_RATIO) h = Math.ceil(w / MAX_RATIO);
  const longest = Math.max(w, h);
  if (longest > MAX_EDGE) {
    const k = MAX_EDGE / longest;
    w = Math.floor(w * k);
    h = Math.floor(h * k);
  }
  /* Rounding must never push the ratio outside the allowed range. */
  while (w / h < MIN_RATIO) w += 1;
  while (w / h > MAX_RATIO) h += 1;
  return { width: w, height: h };
}

/* Only real raster images. SVG, HTML and anything else is refused. */
export function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export function mediaUrlFor(env, id) {
  return (env.SITE_ORIGIN || "https://tahastudiolabs.com") + "/api/vault/social/media/" + id + ".jpg";
}

export async function storeMedia(env, bytes, actor) {
  if (!env.FILES) return { error: "storage_unavailable" };
  if (!bytes || !bytes.length) return { error: "empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { error: "too_large" };
  const type = sniffImage(bytes);
  if (!type) return { error: "bad_type" };
  const id = randomToken(18);
  await env.FILES.put(MEDIA_PREFIX + id, bytes, { httpMetadata: { contentType: type }, customMetadata: { uploadedBy: String(actor || "") } });
  return { id, url: mediaUrlFor(env, id), bytes: bytes.length };
}

function plain(status, text) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function serveMedia(env, rawId) {
  const id = String(rawId || "").replace(/\.jpe?g$/i, "");
  if (!ID_RE.test(id)) return plain(404, "not found");
  if (!env.FILES) return plain(503, "unavailable");
  const obj = await env.FILES.get(MEDIA_PREFIX + id);
  if (!obj) return plain(404, "not found");
  if (!env.IMAGES) return plain(503, "unavailable");
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const stream = () => new Response(bytes).body;
  const info = await env.IMAGES.info(stream());
  const size = targetSize(info && info.width, info && info.height);
  if (!size) return plain(415, "unsupported");
  const background = env.SOCIAL_PAD_COLOR || "#000000";
  const out = await env.IMAGES.input(stream())
    .transform({ width: size.width, height: size.height, fit: "pad", background })
    .output({ format: "image/jpeg", quality: 88 });
  const res = out.response();
  const headers = new Headers(res.headers);
  headers.set("Content-Type", "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  return new Response(res.body, { status: 200, headers });
}
