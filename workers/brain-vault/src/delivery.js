/* V2 phase G1: finished images for the Visual Pack, and the client's brand kit.
   Admin only (index.js checks the admin role before any of these run).

   POST   /admin/delivery/:clientId/:campaignId?visual=v_x&ai=1|0&title=...   raw image body,
          file name in X-File-Name (same upload style as the portal). Stored in R2 at
          c/<clientId>/<deliveryId>, never under the original name.
   GET    /admin/delivery/:clientId/:campaignId                 the campaign's attached files
   GET    /admin/delivery/:clientId/:campaignId/:deliveryId     the file itself
   DELETE /admin/delivery/:clientId/:campaignId/:deliveryId     removes a wrong attachment
   GET    /admin/brandkit/:clientId                             the client's brand kit, or null
   PUT    /admin/brandkit/:clientId {kit}                       save it ({kit:null} clears it)

   The client sees attached files later, in Part B (Your content). Nothing here changes the
   portal. Images are made in Harry's own tools; the Vault only stores what he attaches. */
import { extOf, magicOk, r2Key, TYPES } from "./files.js";
import { json, newId, nowIso, readJson } from "./util.js";
import { looksLikeKey } from "./brain.js";

const MB = 1024 * 1024;
export const DELIVERY_IMAGE = { ext: ["jpg", "jpeg", "png", "webp"], maxBytes: 15 * MB, maxPerCampaign: 120 };

const M = {
  badRequest: { sv: "Ogiltig förfrågan.", en: "Bad request." },
  notFound: { sv: "Hittades inte.", en: "Not found." },
  type: { sv: "Bara JPG, PNG eller WebP.", en: "Only JPG, PNG or WebP images." },
  size: { sv: "Bilden är för stor (högst 15 MB).", en: "The image is too large (15 MB at most)." },
  content: { sv: "Filen är inte en giltig bild.", en: "The file is not a valid image." },
  count: { sv: "Kampanjen har redan för många bilder.", en: "This campaign already has too many images." },
  visual: { sv: "Den bildbriefen finns inte i kampanjen.", en: "That visual brief is not in this campaign." },
  kit: { sv: "Varumärkeskitet är ogiltigt.", en: "The brand kit is not valid." },
  key: { sv: "Texten ser ut att innehålla en API-nyckel.", en: "The text looks like it contains an API key." }
};

const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];

function deliveryUrl(clientId, campaignId, id) {
  return "/api/vault/admin/delivery/" + clientId + "/" + campaignId + "/" + id;
}

export function deliveryOut(r) {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    visualId: r.visual_id || null,
    title: r.title || "",
    kind: r.kind,
    aiImage: r.ai_image === 1,
    mime: r.mime,
    size: r.size,
    width: r.width || null,
    height: r.height || null,
    name: r.original_name || "",
    addedAt: r.added_at,
    url: deliveryUrl(r.client_id, r.campaign_id, r.id)
  };
}

/* Width and height from the image header, so the panel can show whether a finished image
   matches the brief's size. Returns null when it cannot tell. */
export function imageSize(b) {
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + len;
      }
      return null;
    }
    if (b[0] === 0x52 && b[8] === 0x57) {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (fourcc === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      if (fourcc === "VP8L") {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch (e) {}
  return null;
}

async function campaignDoc(env, clientId, campaignId) {
  const r = await env.DB.prepare("SELECT data FROM campaigns WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  return r ? JSON.parse(r.data) : null;
}

export async function addDelivery(request, env, clientId, campaignId, url) {
  const doc = await campaignDoc(env, clientId, campaignId);
  if (!doc) return json({ error: "not_found", message: M.notFound }, 404);
  const visualId = url.searchParams.get("visual") || "";
  if (visualId) {
    if (!/^v_[a-z0-9_]{2,40}$/.test(visualId) || !(doc.visuals || []).some((v) => v.id === visualId)) {
      return json({ error: "visual", message: M.visual }, 400);
    }
  }
  const aiParam = url.searchParams.get("ai");
  if (aiParam !== "1" && aiParam !== "0") return json({ error: "bad_request", message: M.badRequest }, 400);
  const title = String(url.searchParams.get("title") || "").slice(0, 200);
  let name = "";
  try {
    name = decodeURIComponent(request.headers.get("X-File-Name") || "").slice(0, 200);
  } catch (e) {
    name = "";
  }
  const ext = extOf(name);
  if (!DELIVERY_IMAGE.ext.includes(ext)) return json({ error: "type", message: M.type }, 415);
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (!len || len > DELIVERY_IMAGE.maxBytes) return json({ error: "size", message: M.size }, 413);
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE client_id = ? AND campaign_id = ?").bind(clientId, campaignId).first();
  if (count.n >= DELIVERY_IMAGE.maxPerCampaign) return json({ error: "count", message: M.count }, 409);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > DELIVERY_IMAGE.maxBytes) return json({ error: "size", message: M.size }, 413);
  const type = TYPES[ext];
  if (!magicOk(type.magic, buf)) return json({ error: "content", message: M.content }, 415);
  const dims = imageSize(buf) || {};
  const id = newId("d", 16);
  const key = r2Key(clientId, id);
  await env.FILES.put(key, buf, { httpMetadata: { contentType: type.mime } });
  const t = nowIso();
  await env.DB.prepare(
    "INSERT INTO deliveries (id, client_id, campaign_id, visual_id, title, kind, ai_image, mime, size, width, height, r2_key, original_name, added_at) VALUES (?, ?, ?, ?, ?, 'image', ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, clientId, campaignId, visualId || null, title, aiParam === "1" ? 1 : 0, type.mime, buf.length, dims.width || null, dims.height || null, key, name, t)
    .run();
  const row = await env.DB.prepare("SELECT * FROM deliveries WHERE id = ?").bind(id).first();
  return json({ ok: true, delivery: deliveryOut(row) }, 201);
}

export async function listDeliveries(env, clientId, campaignId) {
  const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const rows = await all(env, "SELECT * FROM deliveries WHERE client_id = ? AND campaign_id = ? ORDER BY added_at ASC", clientId, campaignId);
  return json({ deliveries: rows.map(deliveryOut) });
}

export async function getDelivery(env, clientId, campaignId, id) {
  const r = await env.DB.prepare("SELECT * FROM deliveries WHERE id = ? AND client_id = ? AND campaign_id = ?").bind(id, clientId, campaignId).first();
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  const obj = await env.FILES.get(r.r2_key);
  if (!obj) return json({ error: "not_found", message: M.notFound }, 404);
  const safeName = String(r.original_name || "image").replace(/[^\w.\- ]+/g, "_");
  return new Response(obj.body, {
    headers: {
      "Content-Type": r.mime,
      "Content-Disposition": 'inline; filename="' + safeName + '"',
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    }
  });
}

export async function deleteDelivery(env, clientId, campaignId, id) {
  const r = await env.DB.prepare("SELECT r2_key FROM deliveries WHERE id = ? AND client_id = ? AND campaign_id = ?").bind(id, clientId, campaignId).first();
  if (!r) return json({ error: "not_found", message: M.notFound }, 404);
  await env.FILES.delete(r.r2_key);
  await env.DB.prepare("DELETE FROM deliveries WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

/* ---------- brand kit ---------- */

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/* Keeps only what the briefs and pages use; returns null when the kit is not usable. */
export function cleanKit(k) {
  if (!k || typeof k !== "object" || Array.isArray(k)) return null;
  const colors = (Array.isArray(k.colors) ? k.colors : [])
    .filter((c) => c && typeof c === "object" && HEX.test(String(c.hex || "")))
    .slice(0, 12)
    .map((c) => ({ role: str(c.role, 40) || "colour", hex: String(c.hex).toUpperCase() }));
  if (!colors.length) return null;
  const fonts = (Array.isArray(k.fonts) ? k.fonts : []).map((f) => str(f, 80)).filter(Boolean).slice(0, 6);
  return {
    name: str(k.name, 200),
    slug: str(k.slug, 80).toLowerCase().replace(/[^a-z0-9-]/g, ""),
    colors,
    fonts,
    logoNotes: str(k.logoNotes, 1000),
    logoPlacement: str(k.logoPlacement, 300) || "Small, in a bottom corner, on the overlay layer, never inside the generated image.",
    source: str(k.source, 200)
  };
}

export async function getBrandKit(env, clientId) {
  const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const r = await env.DB.prepare("SELECT data, updated_at FROM brand_kits WHERE client_id = ?").bind(clientId).first();
  return json({ kit: r ? JSON.parse(r.data) : null, updatedAt: r ? r.updated_at : null });
}

export async function putBrandKit(request, env, clientId) {
  const c = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(clientId).first();
  if (!c) return json({ error: "not_found", message: M.notFound }, 404);
  const b = await readJson(request, 32 * 1024);
  if (!b || !("kit" in b)) return json({ error: "bad_request", message: M.badRequest }, 400);
  if (b.kit === null) {
    await env.DB.prepare("DELETE FROM brand_kits WHERE client_id = ?").bind(clientId).run();
    return json({ ok: true, kit: null });
  }
  if (looksLikeKey(JSON.stringify(b.kit))) return json({ error: "api_key", message: M.key }, 400);
  const kit = cleanKit(b.kit);
  if (!kit) return json({ error: "kit", message: M.kit }, 400);
  const t = nowIso();
  await env.DB.prepare("INSERT INTO brand_kits (client_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(clientId, JSON.stringify(kit), t)
    .run();
  return json({ ok: true, kit, updatedAt: t });
}
