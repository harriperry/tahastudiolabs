/* V2 Part E: the length of an MP4 or MOV clip, read from its header boxes. No decoding and no
   processing: the Vault walks the top-level boxes with small range reads until it finds "moov",
   then reads the "mvhd" box inside it (time scale and duration). Phones write moov at the start
   or at the end of the file; both work. Returns seconds, or null when the header is not found. */

const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u64 = (b, i) => u32(b, i) * 4294967296 + u32(b, i + 4);
const type4 = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

/* mvhd inside the bytes of a moov box (box header included). */
export function durationFromMoov(moov) {
  let i = 8;
  while (i + 8 <= moov.length) {
    let size = u32(moov, i);
    const t = type4(moov, i + 4);
    let head = 8;
    if (size === 1) { size = u64(moov, i + 8); head = 16; }
    if (size < head) return null;
    if (t === "mvhd") {
      const c = i + head;
      const v = moov[c];
      const scale = v === 1 ? u32(moov, c + 20) : u32(moov, c + 12);
      const dur = v === 1 ? u64(moov, c + 24) : u32(moov, c + 16);
      if (!scale) return null;
      return dur / scale;
    }
    i += size;
  }
  return null;
}

/* read(offset, length) returns a Uint8Array (fewer bytes at the end of the file). */
export async function durationOf(read, fileSize) {
  let off = 0;
  for (let n = 0; n < 64 && off + 8 <= fileSize; n++) {
    const hb = await read(off, 16);
    if (hb.length < 8) return null;
    let size = u32(hb, 0);
    const t = type4(hb, 4);
    if (size === 1) size = u64(hb, 8);
    else if (size === 0) size = fileSize - off;
    if (size < 8) return null;
    if (t === "moov") {
      const moov = await read(off, Math.min(size, 8 * 1024 * 1024));
      return durationFromMoov(moov);
    }
    off += size;
  }
  return null;
}

export function r2Reader(bucket, key) {
  return async (offset, length) => {
    const obj = await bucket.get(key, { range: { offset, length } });
    return obj ? new Uint8Array(await obj.arrayBuffer()) : new Uint8Array(0);
  };
}

/* The first box of an MP4 or MOV: "ftyp" on every phone, other QuickTime boxes on older files. */
const FIRST = ["ftyp", "wide", "free", "skip", "mdat", "moov", "pnot"];
export function looksLikeMp4(first) {
  return first.length >= 12 && FIRST.includes(type4(first, 4));
}
