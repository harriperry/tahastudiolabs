/* ScriptForge Growth Clients panel: the Visual Pack (TAHA Growth Department V2, phase G1).
   Loaded by growth-campaign.js for the admin only, as an ES module.

   Make visuals (and Add visuals for campaigns made before Part G), step by step:
   1. ScriptForge decides which outputs need a picture and at what size: buildSlots() reads
      assets/growth/platforms.json, where every size and clear zone lives.
   2. One prompt (assets/growth/visuals.prompt.json) goes through ScriptForge's own /api/format
      relay with the provider, key and model from section 2, together with the campaign, the
      brain's audience and voice, the client's photos and the brand kit. The key never goes to
      the Brain Vault.
   3. normalizeVisuals() puts the fixed sizes back, enforces the house rules (real product
      means a real client photo or Photo needed from client, no text in any image, people cast
      from the brain) and lists what is still wrong; the answer is validated against the
      campaign-2 schema and retried once with the list of problems.
   4. Each output card shows its briefs with Copy prompt, the overlay text, the size and
      Attach finished image. Attached images go to the Vault (R2, the client's folder) with an
      ai_image flag, and are listed on the card and in the Visual Pack strip.
   Images are made in Harry's own tools. Nothing is rendered on the server. */
import { validate } from "./growth-validate.js?v=p5";
import { stripDashes } from "./growth-brain.js?v=e";

export const PLATFORMS_URL = "/assets/growth/platforms.json?v=g1";
export const VISUALS_PROMPT_URL = "/assets/growth/visuals.prompt.json?v=g2a";

/* Fields ScriptForge sets from platforms.json; the model never writes them. */
const SET_BY_SCRIPTFORGE = ["output_key", "platform", "placement", "ratio", "width", "height", "clear_zone"];
const MUST_BE_CLIENT_PHOTO = ["product", "place", "team"];
const CHANNEL_LABEL = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", google_business: "Google Business", email: "Email" };

/* ---------- pure helpers (exported for tests) ---------- */

const short = (s, n) => {
  const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trim() + "..." : t;
};

function slotFrom(platforms, platformKey, extra) {
  const p = platforms.platforms[platformKey];
  if (!p) throw new Error("platforms.json has no " + platformKey);
  return Object.assign({
    platform: platformKey,
    placement: p.label,
    ratio: p.ratio,
    width: p.width,
    height: p.height,
    clear_zone: p.clear_zone,
    focus: p.focus
  }, extra);
}

/* Every brief a campaign needs, in card order. Pure: same campaign, same slots. */
export function buildSlots(doc, platforms) {
  const S = platforms.slots;
  const channels = doc.channels || [];
  const out = [];
  const offerText = doc.offer ? short(doc.offer.framing + " " + (doc.offer.terms || ""), 400) : "";
  if (doc.offer) out.push(slotFrom(platforms, S.offer, { id: "v_offer", output_key: "offer", copy: offerText }));
  if (doc.shortVideo) {
    out.push(slotFrom(platforms, S.videoCover.default, { id: "v_video_cover", output_key: "shortVideo.cover", copy: "Cover image for the 30 second short video: " + short(doc.shortVideo.script, 500) }));
    if (channels.includes("tiktok")) out.push(slotFrom(platforms, S.videoCover.tiktok, { id: "v_video_cover_tiktok", output_key: "shortVideo.cover_tiktok", copy: "TikTok cover and opening frame for the same short video." }));
  }
  (doc.socialCopy || []).forEach((p) => {
    const key = S.socialCopy[p.channel];
    if (key) out.push(slotFrom(platforms, key, { id: "v_social_" + p.channel, output_key: "socialCopy." + p.channel, copy: short(p.text, 500) }));
  });
  const adChannel = S.adPlatformOrder.find((c) => channels.includes(c)) || "facebook";
  (doc.adVariations || []).forEach((a, i) => {
    out.push(slotFrom(platforms, S.adPlatform[adChannel], {
      id: "v_ad_" + (i + 1),
      output_key: "adVariations." + (i + 1),
      angle: S.adAngles[i % S.adAngles.length],
      placement: platforms.platforms[S.adPlatform[adChannel]].label + ", ad " + (i + 1),
      copy: short(a.headline + ". " + a.primaryText, 400)
    }));
  });
  if (doc.landingPage) {
    out.push(slotFrom(platforms, S.landingPage.hero, { id: "v_lp_hero", output_key: "landingPage.hero", copy: short(doc.landingPage.headline + ". " + doc.landingPage.subheadline, 300) }));
    out.push(slotFrom(platforms, S.landingPage.og, { id: "v_lp_og", output_key: "landingPage.og", copy: short(doc.landingPage.headline, 200) }));
  }
  if (doc.email) out.push(slotFrom(platforms, S.email, { id: "v_email", output_key: "email", copy: short((doc.email.subjects || [])[0] + ". " + doc.email.body, 300) }));
  if (doc.googleBusinessPost) out.push(slotFrom(platforms, S.googleBusinessPost, { id: "v_gbp", output_key: "googleBusinessPost", copy: short(doc.googleBusinessPost.text, 400) }));
  return out;
}

/* The part of a brief the model writes, cut from the campaign-2 schema. */
export function briefModelSchema(campaignSchema) {
  const item = JSON.parse(JSON.stringify(campaignSchema.properties.visuals.items));
  for (const k of SET_BY_SCRIPTFORGE) delete item.properties[k];
  item.required = item.required.filter((k) => !SET_BY_SCRIPTFORGE.includes(k));
  item.required.push("subject");
  return item;
}

/* Words that ask for writing inside the picture. */
const TEXT_ASKS = /\b(text|caption|headline|lettering|letters|typography|slogan|signage|sign (that|which) (reads|says)|that (reads|says)|menu board|label(s|led)? (that|which|with)|logo|watermark)\b/i;

/* Returns the reasons a prompt would put text into the image (empty when clean). The fixed
   no text sentence is ignored, and so is any "no ..." or "without ..." phrase. */
export function textInPrompt(prompt, overlay, noTextSentence) {
  const reasons = [];
  let p = String(prompt || "");
  if (noTextSentence) p = p.split(noTextSentence).join(" ");
  const cleaned = p
    .replace(/\b(no|without|free of|never|avoid|keep (it|the [a-z ]+) (free of|clear of))\b[^.;]*/gi, " ")
    .replace(/\b(empty|clear|calm) (space|area|zone|background)[^.;]*/gi, " ")
    .replace(/\b(overlay|clear zone|space for (the )?(text|headline|copy))\b[^.;]*/gi, " ")
    .replace(/\b(room|space|area|zone|corner) (left )?(for|reserved for) (the )?(logo|text|headline|copy|offer text|cta|button)\b[^.;]*/gi, " ")
    .replace(/\b(the )?logo (is|will be|goes|sits) [^.;]*/gi, " ");
  if (/["\u201c\u201d][^"\u201c\u201d]{2,}["\u201c\u201d]/.test(cleaned)) reasons.push("quotes words that would be written in the image");
  if (TEXT_ASKS.test(cleaned)) reasons.push("asks for text, a sign or a logo inside the image");
  const o = overlay || {};
  for (const k of ["headline", "cta"]) {
    const t = String(o[k] || "").trim().toLowerCase();
    if (t.length >= 6 && p.toLowerCase().includes(t)) reasons.push("repeats the overlay " + k + " in the prompt");
  }
  return Array.from(new Set(reasons));
}

/* Fills in what ScriptForge owns, enforces the rules it can enforce and lists the rest.
   ctx: { photoIds, language, noTextSentence, avoidDefault }. Returns { visuals, problems, fixes }. */
export function normalizeVisuals(raw, slots, ctx) {
  const list = raw && Array.isArray(raw.visuals) ? raw.visuals : Array.isArray(raw) ? raw : [];
  const byId = {};
  list.forEach((v) => { if (v && typeof v === "object" && typeof v.id === "string" && !byId[v.id]) byId[v.id] = v; });
  const photoIds = new Set(ctx.photoIds || []);
  const problems = [];
  const fixes = [];
  const visuals = [];
  for (const slot of slots) {
    const m = byId[slot.id];
    if (!m) {
      problems.push(slot.id + ": missing (one item per brief, with this id)");
      continue;
    }
    const v = stripDashes(Object.assign({}, m));
    for (const k of SET_BY_SCRIPTFORGE) v[k] = slot[k];
    v.id = slot.id;
    if (!v.subject) problems.push(slot.id + ": subject is missing");
    if (MUST_BE_CLIENT_PHOTO.includes(v.subject) && v.source !== "client_photo") {
      v.source = "client_photo";
      fixes.push(slot.id + ": a " + v.subject + " shot uses a client photo");
    }
    if (v.source === "client_photo") {
      if (v.photo_ref != null && !photoIds.has(v.photo_ref)) {
        fixes.push(slot.id + ": " + v.photo_ref + " is not one of the client's photos, marked Photo needed from client");
        v.photo_ref = null;
      }
      if (v.photo_ref === undefined) v.photo_ref = null;
    } else {
      v.photo_ref = null;
      const prompt = String(v.prompt || "").trim();
      if (prompt && ctx.noTextSentence && !prompt.includes(ctx.noTextSentence)) v.prompt = prompt.replace(/\s*$/, "") + " " + ctx.noTextSentence;
      const why = textInPrompt(v.prompt, v.overlay, ctx.noTextSentence);
      if (why.length) problems.push(slot.id + ": the prompt " + why.join(" and ") + "; put all words in overlay and keep the image free of text");
      if (v.subject === "people" && !String(v.cast || "").trim()) problems.push(slot.id + ": people appear, so write who in cast, from the brain's target audience");
    }
    if (typeof v.cast !== "string") v.cast = "";
    const avoid = String(v.avoid || "").trim();
    if (ctx.avoidDefault && !/\btext\b/i.test(avoid)) v.avoid = ctx.avoidDefault + (avoid ? ", " + avoid : "");
    if (ctx.language === "both") {
      if (!v.overlay_alt) problems.push(slot.id + ": overlay_alt (the English overlay) is missing");
    } else delete v.overlay_alt;
    const ordered = {};
    if (!(v.source === "client_photo" && !v.photo_ref)) delete v.photo_request;
    ["id", "output_key", "platform", "placement", "ratio", "width", "height", "subject", "source", "photo_ref", "cast", "prompt", "avoid", "overlay", "overlay_alt", "clear_zone", "alt_text", "photo_request"].forEach((k) => { if (k in v) ordered[k] = v[k]; });
    visuals.push(ordered);
  }
  return { visuals, problems, fixes };
}

/* After the retry, only hard faults stop the run: unreadable JSON, a schema error or a missing
   brief. Rule warnings (text-like words in a prompt, no cast) keep the brief and are shown on
   its card, keyed by brief id, so one cautious word cannot throw away a whole pack. */
export function splitProblems(errs) {
  const hard = [];
  const soft = {};
  for (const e of errs || []) {
    const m = /^(v_[a-z0-9_]+): (.*)$/.exec(e);
    if (!m || /: missing|subject is missing/.test(e)) hard.push(e);
    else (soft[m[1]] = soft[m[1]] || []).push(m[2]);
  }
  return { hard, soft };
}

/* Schema errors for a whole Visual Pack, using the campaign-2 item schema. */
export function checkVisuals(campaignSchema, visuals) {
  const arr = campaignSchema.properties.visuals;
  const r = validate({ type: "object", properties: { visuals: arr }, required: ["visuals"] }, { visuals });
  return r.valid ? [] : r.errors;
}

/* The campaign with its Visual Pack: a campaign-2 document. */
export function withVisuals(doc, visuals, at) {
  return Object.assign({}, doc, { schemaVersion: "campaign-2", visuals, visualsMadeAt: at || new Date().toISOString() });
}

export function briefsFor(doc, cardKey) {
  return (doc && Array.isArray(doc.visuals) ? doc.visuals : []).filter((v) => v.output_key === cardKey || v.output_key.split(".")[0] === cardKey);
}

/* Default wording of a photo request for briefs made before G2a (no photo_request): the
   brief's prompt is written to Harry ("Ask the client for..."), so it is turned around. */
export function requestDefault(v) {
  if (v.photo_request && v.photo_request.en) return { en: v.photo_request.en, sv: v.photo_request.sv || "" };
  let en = String(v.prompt || "").trim()
    .replace(/^(please )?ask (the )?(client|owner|business)( to send| to take| for)?\s*/i, "Please send us ")
    .replace(/^request (from the client )?/i, "Please send us ")
    .replace(/\bthe client('s)?\b/gi, (m, s1) => (s1 ? "your" : "you"));
  if (en && !/^please/i.test(en)) en = "Please send us this photo: " + en.charAt(0).toLowerCase() + en.slice(1);
  return { en, sv: "" };
}

export function photoNeeded(v) {
  return v.source === "client_photo" && !v.photo_ref;
}

export function sizeLabel(v) {
  return v.width + " x " + v.height + " (" + v.ratio + ")";
}

/* What Copy prompt puts on the clipboard: ready to paste into an image tool. */
export function copyText(v, photoName) {
  const lines = [];
  if (v.source === "client_photo") {
    lines.push(photoNeeded(v) ? "PHOTO NEEDED FROM CLIENT" : "EDIT THE CLIENT PHOTO" + (photoName ? " (" + photoName + ")" : ""));
    lines.push(v.prompt);
  } else lines.push(v.prompt);
  lines.push("");
  lines.push("Size: " + v.width + " x " + v.height + " px, aspect ratio " + v.ratio + ".");
  lines.push("Keep clear for text: " + v.clear_zone);
  if (v.avoid) lines.push("Avoid: " + v.avoid);
  return lines.join("\n");
}

export function overlayText(v) {
  const o = v.overlay || {};
  const parts = [o.headline, o.sub, o.cta ? "[" + o.cta + "]" : ""].filter(Boolean);
  let t = parts.join("\n");
  if (v.overlay_alt) {
    const a = v.overlay_alt;
    t += "\n\nEN:\n" + [a.headline, a.sub, a.cta ? "[" + a.cta + "]" : ""].filter(Boolean).join("\n");
  }
  return t;
}

export function packSummary(doc, deliveries) {
  const v = (doc && doc.visuals) || [];
  const attached = new Set((deliveries || []).map((d) => d.visualId).filter(Boolean));
  return {
    briefs: v.length,
    clientPhotos: v.filter((x) => x.source === "client_photo" && x.photo_ref).length,
    photoNeeded: v.filter(photoNeeded).length,
    aiImages: v.filter((x) => x.source === "ai_image").length,
    withImage: v.filter((x) => attached.has(x.id)).length,
    images: (deliveries || []).length
  };
}

/* A brand.json from D:\BRAND-KITS (the brand-kit-manager format) to the kit the Vault keeps. */
export function kitFromBrandJson(b) {
  if (!b || typeof b !== "object") return null;
  const colors = [];
  const pal = b.palette && typeof b.palette === "object" ? b.palette : {};
  Object.keys(pal).forEach((role) => {
    const hex = String(pal[role] || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) colors.push({ role, hex: hex.toUpperCase() });
  });
  const fontName = (f) => String(f || "").split("/").pop().replace(/\.(ttf|otf|woff2?)$/i, "").replace(/[-_]+/g, " ").trim();
  const fonts = Array.from(new Set(Object.values(b.fonts && typeof b.fonts === "object" ? b.fonts : {}).map(fontName).filter(Boolean)));
  const lf = b.logo_files && typeof b.logo_files === "object" ? b.logo_files : {};
  return {
    name: String(b.name || ""),
    slug: String(b.slug || ""),
    colors,
    fonts,
    logoNotes: [lf.notes, b.logo_status].filter(Boolean).join(" ").slice(0, 1000),
    logoPlacement: "Small, in a bottom corner, on the overlay layer, never inside the generated image.",
    source: "BRAND-KITS/" + String(b.slug || "") + "/brand.json"
  };
}

export function kitPromptText(kit) {
  if (!kit) return "";
  return [
    "Name: " + (kit.name || ""),
    "Colours: " + kit.colors.map((c) => c.role + " " + c.hex).join(", "),
    kit.fonts && kit.fonts.length ? "Fonts (overlay only): " + kit.fonts.join(", ") : "",
    "Logo: " + (kit.logoPlacement || "") + (kit.logoNotes ? " " + kit.logoNotes : "")
  ].filter(Boolean).join("\n");
}

/* The brain fields the art director needs: who the customers are, the voice and the words. */
export function brainForVisuals(brain) {
  return {
    positioning: brain.positioning,
    personas: brain.personas,
    voice: { summary: brain.voice && brain.voice.summary, do: brain.voice && brain.voice.do, dont: brain.voice && brain.voice.dont },
    words: brain.words,
    contentPillars: brain.contentPillars
  };
}

/* Client photos with what the brain says about them. */
export function photoList(files, brain) {
  const notes = {};
  ((brain && brain.imageNotes) || []).forEach((n) => { notes[n.fileId] = n; });
  return (files || []).filter((f) => f.section === "pictures").map((f) => ({
    fileId: f.id,
    name: f.name,
    caption: notes[f.id] ? notes[f.id].caption : "",
    bestUse: notes[f.id] ? notes[f.id].bestUse : ""
  }));
}

/* ---------- the panel UI ---------- */

export function createVisualsUi(ctx) {
  const { h, clear, api } = ctx;
  const when = ctx.when || ((x) => x || "");
  const deliveries = {};
  const kits = {};

  function dkey(clientId, campaignId) {
    return clientId + "/" + campaignId;
  }

  function loadDeliveries(clientId, campaignId, force) {
    const k = dkey(clientId, campaignId);
    const s = deliveries[k] || (deliveries[k] = { loaded: false, loading: false, list: [], busy: {}, msg: {} });
    if ((s.loaded && !force) || s.loading) return s;
    s.loading = true;
    api("/admin/delivery/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId)).then((r) => {
      s.loading = false;
      if (r.ok && r.d) {
        s.loaded = true;
        s.list = r.d.deliveries || [];
      } else if (r.status === 404) {
        s.loaded = true;
        s.list = [];
      }
      ctx.rerender(clientId);
    });
    return s;
  }

  function kitState(clientId, force) {
    const s = kits[clientId] || (kits[clientId] = { loaded: false, loading: false, kit: null, editing: false, msg: null });
    if ((s.loaded && !force) || s.loading) return s;
    s.loading = true;
    api("/admin/brandkit/" + encodeURIComponent(clientId)).then((r) => {
      s.loading = false;
      s.loaded = true;
      s.kit = r.ok && r.d ? r.d.kit : null;
      ctx.rerender(clientId);
    });
    return s;
  }

  async function saveKit(clientId, kit) {
    const s = kitState(clientId);
    const r = await api("/admin/brandkit/" + encodeURIComponent(clientId), { method: "PUT", body: { kit } });
    if (r.ok && r.d) {
      s.kit = r.d.kit;
      s.editing = false;
      s.msg = { cls: "ok", text: kit ? "Brand kit saved." : "Brand kit removed." };
    } else s.msg = { cls: "err", text: (r.d && r.d.message && r.d.message.en) || "Could not save the brand kit." };
    ctx.rerender(clientId);
  }

  async function attach(clientId, campaignId, v, file, aiImage) {
    const s = loadDeliveries(clientId, campaignId);
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) { s.msg[v.id] = { cls: "err", text: "Use a JPG, PNG or WebP image." }; ctx.rerender(clientId); return; }
    if (file.size > 15 * 1024 * 1024) { s.msg[v.id] = { cls: "err", text: "The image is larger than 15 MB." }; ctx.rerender(clientId); return; }
    s.busy[v.id] = true;
    s.msg[v.id] = null;
    ctx.rerender(clientId);
    const q = "?visual=" + encodeURIComponent(v.id) + "&ai=" + (aiImage ? "1" : "0") + "&title=" + encodeURIComponent(v.placement);
    let r;
    try {
      const res = await fetch("/api/vault/admin/delivery/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId) + q, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-File-Name": encodeURIComponent(file.name), "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      let d = null;
      try { d = await res.json(); } catch (e) {}
      r = { ok: res.ok, d };
    } catch (e) {
      r = { ok: false, d: null };
    }
    s.busy[v.id] = false;
    if (r.ok && r.d && r.d.delivery) {
      s.list.push(r.d.delivery);
      const dl = r.d.delivery;
      const off = dl.width && dl.height && (dl.width !== v.width || dl.height !== v.height);
      s.msg[v.id] = { cls: off ? "info" : "ok", text: "Attached." + (off ? " It is " + dl.width + " x " + dl.height + "; the brief asks for " + v.width + " x " + v.height + "." : "") };
    } else s.msg[v.id] = { cls: "err", text: (r.d && r.d.message && r.d.message.en) || "Could not attach the image." };
    ctx.rerender(clientId);
  }

  async function removeDelivery(clientId, campaignId, d) {
    const s = loadDeliveries(clientId, campaignId);
    const r = await api("/admin/delivery/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId) + "/" + encodeURIComponent(d.id), { method: "DELETE" });
    if (r.ok) s.list = s.list.filter((x) => x.id !== d.id);
    ctx.rerender(clientId);
  }

  function thumb(d, onRemove) {
    const off = d.width && d.height ? d.width + " x " + d.height : "";
    return h("figure", { class: "gv-thumb" },
      h("a", { href: d.url, target: "_blank", rel: "noopener" }, h("img", { src: d.url, alt: d.title || "Finished image", loading: "lazy" })),
      h("figcaption", null,
        h("span", { class: "gc-badge " + (d.aiImage ? "warn" : "ok"), text: d.aiImage ? "AI image" : "Real photo" }),
        off ? h("span", { class: "gc-meta", text: off }) : null,
        onRemove ? h("button", { type: "button", class: "gc-link", on: { click: onRemove } }, "Remove") : null));
  }

  /* The briefs under one output card. opts: { clientId, campaignId, savedVisualIds, files,
     onEdit, copy, editing, toggleEdit } */
  function renderBriefs(box, briefs, opts) {
    if (!briefs.length) return;
    const wrap = h("div", { class: "gv-briefs" }, h("div", { class: "gc-label", text: briefs.length === 1 ? "Visual brief" : "Visual briefs (" + briefs.length + ")" }));
    const ds = opts.campaignId ? loadDeliveries(opts.clientId, opts.campaignId) : null;
    briefs.forEach((v) => {
      const photo = v.photo_ref ? (opts.files || []).find((f) => f.id === v.photo_ref) : null;
      const status = photoNeeded(v)
        ? h("span", { class: "gc-badge warn", text: "Photo needed from client" })
        : v.source === "client_photo"
          ? h("span", { class: "gc-badge ok", text: "Client photo" })
          : h("span", { class: "gc-badge", text: "AI image, mood only" });
      const card = h("div", { class: "gv-brief" + (photoNeeded(v) ? " need" : "") });
      card.appendChild(h("div", { class: "gv-head" },
        h("b", { text: v.placement }),
        h("span", { class: "gv-size", text: sizeLabel(v) }),
        status));
      const msg = h("div", { class: "gc-meta", role: "status" });
      const tools = h("div", { class: "gc-card-actions" },
        h("button", { type: "button", class: "gc-link", on: { click: () => opts.copy(copyText(v, photo && photo.name), () => { msg.textContent = "Prompt copied."; }) } }, photoNeeded(v) ? "Copy photo request" : "Copy prompt"),
        h("button", { type: "button", class: "gc-link", on: { click: () => opts.copy(overlayText(v), () => { msg.textContent = "Overlay copied."; }) } }, "Copy overlay"),
        h("button", { type: "button", class: "gc-link", on: { click: () => opts.toggleEdit(v.id) } }, opts.editing[v.id] ? "Done" : "Edit"));
      card.appendChild(tools);
      const warn = opts.warnings && opts.warnings[v.id];
      if (warn && warn.length) card.appendChild(h("div", { class: "gc-msg info", text: "Check before you use it: " + warn.join("; ") + "." }));
      if (opts.editing[v.id]) {
        const field = (label, get, set, rows) => {
          const id = "gv-" + v.id + "-" + label.replace(/\W+/g, "").toLowerCase();
          const el = rows ? h("textarea", { id, class: "gc-ta", rows: String(rows) }) : h("input", { id, type: "text" });
          el.value = get() || "";
          el.addEventListener("input", () => { set(el.value); opts.onEdit(); });
          return h("div", { class: "gc-ed" }, h("label", { for: id, text: label }), el);
        };
        card.appendChild(field("Prompt (English)", () => v.prompt, (x) => { v.prompt = x; }, 6));
        card.appendChild(field("Overlay headline", () => v.overlay.headline, (x) => { v.overlay.headline = x; }));
        card.appendChild(field("Overlay line", () => v.overlay.sub, (x) => { v.overlay.sub = x; }));
        card.appendChild(field("Overlay button", () => v.overlay.cta, (x) => { v.overlay.cta = x; }));
        card.appendChild(field("Alt text, Swedish", () => v.alt_text.sv, (x) => { v.alt_text.sv = x; }, 2));
        card.appendChild(field("Alt text, English", () => v.alt_text.en, (x) => { v.alt_text.en = x; }, 2));
      } else {
        if (photo) card.appendChild(h("div", { class: "gv-photo" },
          h("a", { href: photo.url, target: "_blank", rel: "noopener" }, h("img", { src: photo.url, alt: photo.name || "Client photo", loading: "lazy" })),
          h("span", { class: "gc-meta", text: "Use: " + (photo.name || photo.id) })));
        card.appendChild(h("p", { class: "gv-prompt", text: v.prompt }));
        const o = v.overlay || {};
        card.appendChild(h("div", { class: "gv-overlay" },
          h("span", { class: "gc-meta", text: "Overlay" }),
          h("b", { text: o.headline || "" }), o.sub ? h("span", { text: o.sub }) : null, o.cta ? h("span", { class: "gv-cta", text: o.cta }) : null,
          v.overlay_alt ? h("span", { class: "gc-meta", text: "EN: " + [v.overlay_alt.headline, v.overlay_alt.sub, v.overlay_alt.cta].filter(Boolean).join(" · ") }) : null));
        card.appendChild(h("div", { class: "gc-meta", text: "Keep clear: " + v.clear_zone }));
        if (v.cast) card.appendChild(h("div", { class: "gc-meta", text: "Cast: " + v.cast }));
        if (v.avoid) card.appendChild(h("div", { class: "gc-meta", text: "Avoid: " + v.avoid }));
        card.appendChild(h("div", { class: "gc-meta", text: "Alt text: " + v.alt_text.sv + " / " + v.alt_text.en }));
      }

      /* Attached images and Attach finished image */
      const mine = ds ? ds.list.filter((d) => d.visualId === v.id) : [];
      if (mine.length) card.appendChild(h("div", { class: "gv-thumbs" }, mine.map((d) => thumb(d, () => removeDelivery(opts.clientId, opts.campaignId, d)))));
      const canAttach = opts.campaignId && opts.savedVisualIds.has(v.id);
      if (!canAttach) card.appendChild(h("div", { class: "gc-meta", text: "Save the campaign to attach finished images." }));
      else if (ds && ds.busy[v.id]) card.appendChild(h("div", { class: "gc-meta" }, h("span", { class: "spin" }), "Uploading..."));
      else {
        const fid = "gv-file-" + v.id;
        const aid = "gv-ai-" + v.id;
        const input = h("input", { type: "file", id: fid, accept: "image/jpeg,image/png,image/webp", class: "gv-file" });
        const ai = h("input", { type: "checkbox", id: aid, checked: v.source === "ai_image" });
        input.addEventListener("change", () => attach(opts.clientId, opts.campaignId, v, input.files && input.files[0], ai.checked));
        card.appendChild(h("div", { class: "gv-attach" },
          input, h("label", { for: fid, class: "btn-copy gv-attach-btn" }, "Attach finished image"),
          h("label", { for: aid, class: "gc-check" }, ai, "Made with AI")));
      }
      if (ds && ds.msg[v.id]) card.appendChild(h("div", { class: "gc-msg " + ds.msg[v.id].cls, text: ds.msg[v.id].text }));
      card.appendChild(msg);
      wrap.appendChild(card);
    });
    box.appendChild(wrap);
  }

  /* The brand kit line and its editor. */
  function renderKit(box, clientId) {
    const s = kitState(clientId);
    const row = h("div", { class: "gv-kit" });
    if (!s.loaded) {
      row.appendChild(h("span", { class: "gc-meta" }, h("span", { class: "spin" }), "Loading the brand kit..."));
      box.appendChild(row);
      return s;
    }
    const fileId = "gv-kit-file-" + clientId;
    const input = h("input", { type: "file", id: fileId, accept: "application/json,.json", class: "gv-file" });
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        const kit = kitFromBrandJson(JSON.parse(await f.text()));
        if (!kit || !kit.colors.length) throw new Error("No colours found in that file.");
        await saveKit(clientId, kit);
      } catch (e) {
        s.msg = { cls: "err", text: "Could not read that brand.json: " + e.message };
        ctx.rerender(clientId);
      }
    });
    if (s.kit) {
      row.appendChild(h("span", { class: "gc-label", text: "Brand kit" }));
      row.appendChild(h("b", { text: s.kit.name || "Saved" }));
      s.kit.colors.forEach((c) => row.appendChild(h("span", { class: "gv-swatch", title: c.role + " " + c.hex, style: "background:" + c.hex })));
      if (s.kit.fonts && s.kit.fonts.length) row.appendChild(h("span", { class: "gc-meta", text: s.kit.fonts.join(", ") }));
    } else {
      row.appendChild(h("span", { class: "gc-label", text: "Brand kit" }));
      row.appendChild(h("span", { class: "gc-meta", text: "None yet. Briefs take colours and mood from the brain until you add one." }));
    }
    row.appendChild(input);
    row.appendChild(h("label", { for: fileId, class: "gc-link" }, "Import brand.json"));
    row.appendChild(h("button", { type: "button", class: "gc-link", on: { click: () => { s.editing = !s.editing; ctx.rerender(clientId); } } }, s.editing ? "Cancel" : s.kit ? "Edit" : "Type colours"));
    box.appendChild(row);
    if (s.editing) {
      const k = s.kit || { name: "", colors: [], fonts: [], logoNotes: "", logoPlacement: "" };
      const ed = h("form", { class: "gv-kit-ed", novalidate: true });
      const mk = (label, val, rows) => {
        const id = "gv-kit-" + label.replace(/\W+/g, "").toLowerCase();
        const el = rows ? h("textarea", { id, class: "gc-ta", rows: String(rows) }) : h("input", { id, type: "text" });
        el.value = val;
        ed.appendChild(h("div", { class: "gc-ed" }, h("label", { for: id, text: label }), el));
        return el;
      };
      const nameIn = mk("Name", k.name || "");
      const colIn = mk("Colours, one per line: role #RRGGBB", (k.colors || []).map((c) => c.role + " " + c.hex).join("\n"), 4);
      const fontIn = mk("Fonts, one per line", (k.fonts || []).join("\n"), 2);
      const logoIn = mk("Logo placement", k.logoPlacement || "Small, in a bottom corner, on the overlay layer, never inside the generated image.");
      const notesIn = mk("Logo notes", k.logoNotes || "", 2);
      ed.appendChild(h("div", { class: "gc-brain-tools" },
        h("button", { type: "submit", class: "gc-brain-btn" }, "Save brand kit"),
        s.kit ? h("button", { type: "button", class: "btn-ghost", on: { click: () => saveKit(clientId, null) } }, "Remove") : null));
      ed.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const colors = colIn.value.split("\n").map((l) => {
          const m = l.match(/^\s*(.*?)\s*(#[0-9a-fA-F]{6})\s*$/);
          return m ? { role: m[1] || "colour", hex: m[2].toUpperCase() } : null;
        }).filter(Boolean);
        if (!colors.length) { s.msg = { cls: "err", text: "Add at least one colour as role #RRGGBB." }; ctx.rerender(clientId); return; }
        saveKit(clientId, { name: nameIn.value, slug: (s.kit && s.kit.slug) || "", colors, fonts: fontIn.value.split("\n").map((x) => x.trim()).filter(Boolean), logoPlacement: logoIn.value, logoNotes: notesIn.value, source: (s.kit && s.kit.source) || "typed in the panel" });
      });
      box.appendChild(ed);
    }
    if (s.msg) box.appendChild(h("div", { class: "gc-msg " + s.msg.cls, role: "status", text: s.msg.text }));
    return s;
  }

  /* The Visual Pack strip above the cards: counts and every finished image. */
  function renderStrip(box, doc, clientId, campaignId) {
    const ds = campaignId ? loadDeliveries(clientId, campaignId) : { list: [] };
    const n = packSummary(doc, ds.list);
    box.appendChild(h("div", { class: "gc-meta", text: n.briefs + " briefs · " + n.clientPhotos + " client photos · " + n.photoNeeded + " photo needed from client · " + n.aiImages + " AI mood images · " + n.images + " finished images attached" }));
    if (ds.list.length) {
      const byId = {};
      (doc.visuals || []).forEach((v) => { byId[v.id] = v; });
      box.appendChild(h("div", { class: "gv-thumbs strip" }, ds.list.map((d) => {
        const f = thumb(d, null);
        const v = byId[d.visualId];
        if (v) f.appendChild(h("span", { class: "gc-meta", text: v.placement }));
        return f;
      })));
    }
  }

  /* ----- V2 phase G2a: photo requests to the client portal ----- */

  const requests = {};
  function reqState(clientId, campaignId, force) {
    const k = dkey(clientId, campaignId);
    const s = requests[k] || (requests[k] = { loaded: false, loading: false, list: [], editing: false, texts: {}, busy: false, msg: null, applied: {}, at: 0 });
    /* Checks again at most once a minute while the panel is open, so new photos show up. */
    const stale = s.loaded && Date.now() - s.at > 60000 && !s.editing && !s.busy;
    if ((s.loaded && !force && !stale) || s.loading) return s;
    s.loading = true;
    s.at = Date.now();
    api("/admin/photo-requests/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId)).then((r) => {
      s.loading = false;
      s.loaded = true;
      s.list = r.ok && r.d ? r.d.requests || [] : [];
      ctx.rerender(clientId);
    });
    return s;
  }

  async function sendRequests(clientId, campaignId, items) {
    const s = reqState(clientId, campaignId);
    s.busy = true;
    s.msg = null;
    ctx.rerender(clientId);
    const r = await api("/admin/photo-requests/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId), { method: "POST", body: { requests: items } });
    s.busy = false;
    if (r.ok && r.d) {
      s.list = r.d.requests || [];
      s.editing = false;
      s.msg = { cls: "ok", text: (r.d.created ? r.d.created + (r.d.created === 1 ? " request" : " requests") + " sent to the client's portal" + (r.d.emailed ? ", and the client was emailed (no campaign content in it)." : ".") : "") + (r.d.updated ? (r.d.created ? " " : "") + r.d.updated + " open " + (r.d.updated === 1 ? "request" : "requests") + " updated." : "") };
    } else s.msg = { cls: "err", text: (r.d && r.d.message && r.d.message.en) || "Could not send the photo requests." };
    ctx.rerender(clientId);
  }

  async function cancelRequest(clientId, campaignId, req) {
    const s = reqState(clientId, campaignId);
    const r = await api("/admin/photo-requests/" + encodeURIComponent(clientId) + "/" + encodeURIComponent(campaignId) + "/" + encodeURIComponent(req.id), { method: "DELETE" });
    if (r.ok) s.list = s.list.map((x) => (x.id === req.id ? Object.assign({}, x, { state: "cancelled" }) : x));
    ctx.rerender(clientId);
  }

  /* opts: { clientId, campaignId, doc, files, onReceived(visualId, fileId) } */
  function renderRequests(box, opts) {
    const { clientId, campaignId, doc } = opts;
    const s = reqState(clientId, campaignId);
    const needed = (doc.visuals || []).filter(photoNeeded);
    const active = s.list.filter((r) => r.state !== "cancelled");
    /* A received photo becomes the brief's photo: the Vault already saved that; show it here too. */
    active.filter((r) => r.state === "received" && r.fileId && !s.applied[r.id]).forEach((r) => {
      s.applied[r.id] = true;
      opts.onReceived(r.visualId, r.fileId);
    });
    if (!needed.length && !active.length) return;
    const wrap = h("div", { class: "gv-req" });
    const openN = active.filter((r) => r.state === "open").length;
    const gotN = active.filter((r) => r.state === "received").length;
    const notSent = needed.filter((v) => !active.some((r) => r.visualId === v.id && r.state === "open"));
    wrap.appendChild(h("div", { class: "gv-head" },
      h("b", { text: "Photo requests" }),
      h("span", { class: "gc-meta", text: active.length ? openN + " waiting · " + gotN + " received" + (notSent.length ? " · " + notSent.length + " not sent yet" : "") : needed.length + (needed.length === 1 ? " brief needs" : " briefs need") + " a photo from the client" })));
    if (!s.loaded) {
      wrap.appendChild(h("div", { class: "gc-meta" }, h("span", { class: "spin" }), "Loading photo requests..."));
      box.appendChild(wrap);
      return;
    }
    if (active.length) {
      wrap.appendChild(h("div", { class: "gv-req-list" }, active.map((r) => {
        const f = r.fileId ? (opts.files || []).find((x) => x.id === r.fileId) : null;
        return h("div", { class: "gv-req-row" },
          r.state === "received"
            ? (f ? h("a", { href: f.url, target: "_blank", rel: "noopener" }, h("img", { src: f.url, alt: "Photo from the client", class: "gv-req-img" })) : h("span", { class: "gc-badge ok", text: "Received" }))
            : h("span", { class: "gc-badge warn", text: "Waiting" }),
          h("div", { class: "gv-req-txt" }, h("b", { text: r.placement || r.visualId }), h("span", { class: "gc-meta", text: r.text.en })),
          r.state === "open" ? h("button", { type: "button", class: "gc-link", on: { click: () => cancelRequest(clientId, campaignId, r) } }, "Cancel") : h("span", { class: "gc-meta", text: when(r.receivedAt) }));
      })));
    }
    if (notSent.length && !s.editing) {
      wrap.appendChild(h("button", { type: "button", class: "gc-brain-btn", on: { click: () => { s.editing = true; ctx.rerender(clientId); } } },
        "Send photo requests to client (" + notSent.length + ")"));
    }
    if (s.editing) {
      const form = h("form", { class: "gv-req-ed", novalidate: true });
      form.appendChild(h("p", { class: "gc-meta", text: "Check the wording: the client reads it exactly as written, in the portal under Photos we need, in her portal language. Leave Swedish empty and she sees the English. The email she gets says only that photos are wanted." }));
      notSent.forEach((v) => {
        const t0 = s.texts[v.id] || (s.texts[v.id] = requestDefault(v));
        const mk = (lang, label) => {
          const id = "gv-req-" + v.id + "-" + lang;
          const ta = h("textarea", { id, class: "gc-ta", rows: "3" });
          ta.value = t0[lang];
          ta.addEventListener("input", () => { t0[lang] = ta.value; });
          return h("div", { class: "gc-ed" }, h("label", { for: id, text: label }), ta);
        };
        form.appendChild(h("div", { class: "gv-brief" }, h("b", { text: v.placement + " · " + sizeLabel(v) }), mk("en", "Request in English"), mk("sv", "Request in Swedish (optional)")));
      });
      form.appendChild(h("div", { class: "gc-brain-tools" },
        h("button", { type: "submit", class: "gc-brain-btn", disabled: s.busy }, s.busy ? "Sending..." : "Send to client portal"),
        h("button", { type: "button", class: "btn-ghost", on: { click: () => { s.editing = false; ctx.rerender(clientId); } } }, "Cancel")));
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const items = notSent.map((v) => ({ visualId: v.id, text: { en: String(s.texts[v.id].en || "").trim(), sv: String(s.texts[v.id].sv || "").trim() } }));
        if (items.some((x) => !x.text.en)) { s.msg = { cls: "err", text: "Every request needs the English text." }; ctx.rerender(clientId); return; }
        sendRequests(clientId, campaignId, items);
      });
      wrap.appendChild(form);
    }
    if (s.msg) wrap.appendChild(h("div", { class: "gc-msg " + s.msg.cls, role: "status", text: s.msg.text }));
    box.appendChild(wrap);
  }

  return { renderBriefs, renderKit, renderStrip, renderRequests, reqState, kitState, loadDeliveries };
}

export { CHANNEL_LABEL };
