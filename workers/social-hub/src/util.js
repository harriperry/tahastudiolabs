/* Small shared helpers for social-hub. No client content and no secrets are ever logged from here. */
const enc = new TextEncoder();

export const SESSION_COOKIE = "__Host-tv_session";

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

export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64url(text) {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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

export async function sha256b64url(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return b64url(new Uint8Array(d));
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

export function intVar(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* House rule: no em-dashes or en-dashes in anything we send out. */
export function noDashes(text) {
  return String(text).replace(/\u2014/g, ", ").replace(/\u2013/g, "-");
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* Returns a normalised https URL, null when empty, or false when invalid. */
export function httpsUrl(value) {
  if (value === undefined || value === null || value === "") return null;
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" && String(value).length <= 2000 ? u.toString() : false;
  } catch (e) {
    return false;
  }
}
