/* Small shared helpers. No client content and no secrets are ever logged from here. */

const enc = new TextEncoder();

export function nowMs() {
  return Date.now();
}

export function nowIso() {
  return new Date().toISOString();
}

export function json(data, status = 200, headers = {}) {
  const h = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  for (const [k, v] of Object.entries(headers)) h.append(k, v);
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function withCookies(response, cookies) {
  if (!cookies || !cookies.length) return response;
  const r = new Response(response.body, response);
  for (const c of cookies) r.headers.append("Set-Cookie", c);
  return r;
}

export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32) {
  const a = new Uint8Array(byteLength);
  crypto.getRandomValues(a);
  return b64url(a);
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function newId(prefix, length = 12) {
  const a = new Uint8Array(length);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += ID_ALPHABET[b % ID_ALPHABET.length];
  return prefix + "_" + s;
}

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch (e) {
        return null;
      }
    }
  }
  return null;
}

export function normEmail(e) {
  return typeof e === "string" ? e.trim().toLowerCase() : "";
}

export function validEmail(e) {
  return typeof e === "string" && e.length < 255 && /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(e);
}

export function lang(value) {
  return value === "en" ? "en" : "sv";
}

/* Read a JSON body with a hard size cap. Returns null on any problem. */
export async function readJson(request, maxBytes = 64 * 1024) {
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    return null;
  }
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* House rule: no em-dashes anywhere. Used on every outgoing email. */
export function noDashes(s) {
  return String(s).replace(/\u2014/g, ", ").replace(/\u2013/g, "-");
}
