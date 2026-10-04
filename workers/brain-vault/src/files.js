/* Upload rules for the client portal. Type and size are checked here, on the server,
   as well as in the browser. Files are stored in R2 under random ids
   (c/<clientId>/<fileId>), never under their original names. No video is accepted. */

const MB = 1024 * 1024;

export const TYPES = {
  jpg: { mime: "image/jpeg", magic: "jpeg" },
  jpeg: { mime: "image/jpeg", magic: "jpeg" },
  png: { mime: "image/png", magic: "png" },
  webp: { mime: "image/webp", magic: "webp" },
  pdf: { mime: "application/pdf", magic: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: "zip" },
  txt: { mime: "text/plain", magic: "text" },
  csv: { mime: "text/csv", magic: "text" }
};

export const SECTIONS = {
  pictures: { ext: ["jpg", "jpeg", "png", "webp"], maxBytes: 10 * MB, maxCount: 20 },
  previousPosts: { ext: ["jpg", "jpeg", "png", "webp"], maxBytes: 10 * MB, maxCount: 15 },
  founderStory: { ext: ["txt", "pdf", "docx"], maxBytes: 5 * MB, maxCount: 1 },
  faqs: { ext: ["txt", "pdf", "docx", "csv"], maxBytes: 5 * MB, maxCount: 1 },
  reviews: { ext: ["txt", "csv", "pdf"], maxBytes: 5 * MB, maxCount: 5 }
};

export function extOf(name) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

export function looksLikeVideo(name, contentType) {
  return /^video\//i.test(contentType || "") || ["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "3gp", "mpeg", "mpg"].includes(extOf(name));
}

/* Checks the first bytes so a renamed file cannot pass as another type. */
export function magicOk(kind, bytes) {
  const b = bytes;
  const at = (i, arr) => arr.every((v, k) => b[i + k] === v);
  if (kind === "jpeg") return b.length > 3 && at(0, [0xff, 0xd8, 0xff]);
  if (kind === "png") return b.length > 8 && at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (kind === "webp") return b.length > 12 && at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
  if (kind === "pdf") return b.length > 4 && at(0, [0x25, 0x50, 0x44, 0x46]);
  if (kind === "zip") return b.length > 4 && at(0, [0x50, 0x4b, 0x03, 0x04]);
  if (kind === "text") {
    const n = Math.min(b.length, 4096);
    for (let i = 0; i < n; i++) if (b[i] === 0) return false;
    return true;
  }
  return false;
}

export function r2Key(clientId, fileId) {
  return "c/" + clientId + "/" + fileId;
}
