/* Token encryption. AES-GCM, 256 bit key, random 96 bit IV per value.
   Stored form: "<keyId>.<iv>.<ciphertext>" (base64url). The key id lets us rotate keys:
   SOCIAL_TOKEN_KEY is the current key (id SOCIAL_TOKEN_KEY_ID, default "k1") and
   SOCIAL_TOKEN_KEY_PREV (id SOCIAL_TOKEN_KEY_PREV_ID) is an optional older key kept only to decrypt.
   Keys are 32 random bytes, base64url or base64 encoded, set as Worker secrets. Only this Worker
   holds them. Nothing here logs plaintext, ciphertext or keys. */
import { b64url, unb64url } from "./util.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function keyList(env) {
  const list = [];
  if (env.SOCIAL_TOKEN_KEY) list.push({ id: env.SOCIAL_TOKEN_KEY_ID || "k1", raw: env.SOCIAL_TOKEN_KEY, current: true });
  if (env.SOCIAL_TOKEN_KEY_PREV) list.push({ id: env.SOCIAL_TOKEN_KEY_PREV_ID || "k0", raw: env.SOCIAL_TOKEN_KEY_PREV, current: false });
  return list;
}

async function importKey(raw) {
  const bytes = unb64url(String(raw).trim());
  if (bytes.length !== 32) throw new Error("token key must be 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function hasTokenKey(env) {
  return keyList(env).some((k) => k.current);
}

export async function encryptToken(env, plaintext) {
  const cur = keyList(env).find((k) => k.current);
  if (!cur) throw new Error("token key missing");
  const key = await importKey(cur.raw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(String(plaintext))));
  return cur.id + "." + b64url(iv) + "." + b64url(ct);
}

export async function decryptToken(env, stored) {
  const parts = String(stored || "").split(".");
  if (parts.length !== 3) throw new Error("bad token format");
  const k = keyList(env).find((x) => x.id === parts[0]);
  if (!k) throw new Error("unknown token key id");
  const key = await importKey(k.raw);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(parts[1]) }, key, unb64url(parts[2]));
  return dec.decode(pt);
}
