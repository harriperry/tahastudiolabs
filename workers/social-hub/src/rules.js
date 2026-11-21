/* Caption rules for real platforms (Facebook and Instagram). Every post needs an image, an own
   genuine caption, and at least 4 different hashtags that help search (SEO). A machine can only
   check the shape, so the originality check is a guard against obvious placeholder text; the
   client still reads and approves every post. Active when SOCIAL_CAPTION_RULES is "on". */
const REAL = ["facebook", "instagram"];
const PLACEHOLDER = /lorem ipsum|your caption here|insert (a )?(caption|text) here|\bplaceholder\b|\bTODO\b|\bTBD\b/i;
const TAG = /(^|\s)#([\p{L}\p{N}_]{2,60})/gu;

export function rulesOn(env) {
  return env && env.SOCIAL_CAPTION_RULES === "on";
}

export function hashtagsOf(text) {
  const seen = new Set();
  for (const m of String(text || "").matchAll(TAG)) {
    if (/\p{L}/u.test(m[2])) seen.add(m[2].toLowerCase());
  }
  return [...seen];
}

/* The caption without hashtags and links, to judge whether there is real writing in it. */
export function captionCore(text) {
  return String(text || "").replace(TAG, " ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
}

/* Returns a list of problem codes. Empty means the post passes. */
export function checkPost(env, { platform, body, mediaUrl }) {
  if (!rulesOn(env) || !REAL.includes(platform)) return [];
  const problems = [];
  if (!mediaUrl) problems.push("image_required");
  const core = captionCore(body);
  if (core.length < 30) problems.push("caption_too_short");
  else if (PLACEHOLDER.test(core)) problems.push("caption_not_original");
  const n = hashtagsOf(body).length;
  if (n < 4) problems.push("hashtags_min");
  if (n > 30) problems.push("hashtags_max");
  return problems;
}
