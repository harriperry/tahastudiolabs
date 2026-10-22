/* Upload rules. Type and size are checked on the server, not only in the browser. Files are
   stored in R2 under random ids (p/<projectId>/<fileId>), never under their original names,
   and are served only as attachments with a fixed content type (never HTML or SVG). */

const MB = 1024 * 1024;

export const CLIENT_TYPES = {
  jpg: { mime: "image/jpeg", magic: "jpeg", max: 15 * MB },
  jpeg: { mime: "image/jpeg", magic: "jpeg", max: 15 * MB },
  png: { mime: "image/png", magic: "png", max: 15 * MB },
  webp: { mime: "image/webp", magic: "webp", max: 15 * MB },
  pdf: { mime: "application/pdf", magic: "pdf", max: 15 * MB },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: "zip", max: 15 * MB },
  txt: { mime: "text/plain", magic: "text", max: 5 * MB },
  mp4: { mime: "video/mp4", magic: "ftyp", max: 50 * MB },
  mov: { mime: "video/quicktime", magic: "ftyp", max: 50 * MB }
};

export const ADMIN_MAX = 95 * MB;
export const ADMIN_TYPES = Object.assign({}, CLIENT_TYPES, {
  srt: { mime: "text/plain", max: ADMIN_MAX },
  vtt: { mime: "text/vtt", max: ADMIN_MAX },
  zip: { mime: "application/zip", max: ADMIN_MAX },
  mp4: { mime: "video/mp4", max: ADMIN_MAX },
  mov: { mime: "video/quicktime", max: ADMIN_MAX },
  pdf: { mime: "application/pdf", max: ADMIN_MAX },
  png: { mime: "image/png", max: ADMIN_MAX },
  jpg: { mime: "image/jpeg", max: ADMIN_MAX },
  jpeg: { mime: "image/jpeg", max: ADMIN_MAX },
  webp: { mime: "image/webp", max: ADMIN_MAX },
  docx: { mime: CLIENT_TYPES.docx.mime, max: ADMIN_MAX },
  txt: { mime: "text/plain", max: ADMIN_MAX }
});

export const MAX_CLIENT_ASSETS = 12;
export const MAX_DELIVERY_FILES = 30;

export function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

export function safeName(name) {
  const base = String(name || "file").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|?*:]/g, "").trim();
  return (base || "file").slice(0, 120);
}

/* Checks the first bytes so a renamed file cannot pass as another type. */
export function magicOk(kind, b) {
  const at = (i, arr) => arr.every((v, k) => b[i + k] === v);
  if (kind === "jpeg") return b.length > 3 && at(0, [0xff, 0xd8, 0xff]);
  if (kind === "png") return b.length > 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (kind === "webp") return b.length > 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
  if (kind === "pdf") return b.length > 4 && at(0, [0x25, 0x50, 0x44, 0x46]);
  if (kind === "zip") return b.length > 4 && at(0, [0x50, 0x4b, 0x03, 0x04]);
  if (kind === "ftyp") return b.length > 12 && at(4, [0x66, 0x74, 0x79, 0x70]);
  if (kind === "text") {
    const n = Math.min(b.length, 4096);
    for (let i = 0; i < n; i++) if (b[i] === 0) return false;
    return true;
  }
  return false;
}

export function r2Key(projectId, fileId) {
  return "p/" + projectId + "/" + fileId;
}

export function downloadResponse(object, file) {
  const type = (ADMIN_TYPES[file.ext] || {}).mime || "application/octet-stream";
  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(object.body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(object.size),
      "Content-Disposition": 'attachment; filename="' + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(file.name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
