/* TAHA STUDIO ScriptEngine extras
   Adds four features that used to live in the earlier Replit build:
     1. CharacterIntelCard   (story page)  Extract Characters, Copy, Save All to Character Registry
     2. ThumbnailPromptCard  (story page)  thumbnail prompt, hook text, colour palette, Redo
     3. ThumbnailsTab        (header tab)  Thumbnail Studio for any platform and aspect ratio
     4. AvatarsTab           (header tab)  portrait prompts for every character in the registry

   Load order: this file is loaded BEFORE app.js (see index.html). It only exposes
   window.SEExtras. app.js passes in its own callAI() and the aiConfig, so the AI provider
   and key chosen in Settings (Anthropic or Grok) are used exactly as they are today. Nothing
   here stores or sends a key anywhere.

   Reliability notes (fixes for the old avatar error "Unterminated string in JSON"):
     - Every call asks for enough output tokens (the old build capped avatars at 500).
     - Replies are read with parseLoose(), which repairs a reply that was cut off mid-string
       instead of throwing, and errors are shown inline instead of in a blocking alert box.
*/
(function () {
  "use strict";
  var React = window.React;
  var h = React.createElement;
  var useState = React.useState;
  var useRef = React.useRef;
  var useEffect = React.useEffect;

  /* ── helpers ─────────────────────────────────────────────────────────────── */

  function copyText(t) {
    try { navigator.clipboard.writeText(t).catch(function () {}); } catch (e) {}
  }

  /* Close whatever a truncated JSON string left open: an unterminated string, then
     arrays and objects in reverse order. Returns the repaired text. */
  function closeUp(s) {
    var stack = [];
    var inStr = false;
    var esc = false;
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (inStr) {
        if (esc) { esc = false; }
        else if (c === "\\") { esc = true; }
        else if (c === '"') { inStr = false; }
        else if (c === "\n") { out += "\\n"; continue; }
        else if (c === "\r") { continue; }
        else if (c === "\t") { out += "\\t"; continue; }
      } else {
        if (c === '"') { inStr = true; }
        else if (c === "{" || c === "[") { stack.push(c); }
        else if (c === "}" || c === "]") { stack.pop(); }
      }
      out += c;
    }
    if (esc) out = out.slice(0, -1);
    if (inStr) out += '"';
    out = out.replace(/[\s,]+$/, "");
    if (/:\s*$/.test(out)) out += "null";
    while (stack.length) out += stack.pop() === "{" ? "}" : "]";
    return out;
  }

  /* Read JSON from an AI reply. Handles code fences, chatter around the JSON, and replies
     that were cut off by the token limit. Returns { value, repaired } or throws a readable error. */
  function parseLoose(text) {
    var s = String(text || "").replace(/```json|```/g, "").trim();
    var start = s.search(/[\[{]/);
    if (start > 0) s = s.slice(start);
    if (!s) throw new Error("The AI returned an empty reply. Please try again.");
    try { return { value: JSON.parse(s), repaired: false }; } catch (e) {}
    var cand = s;
    for (var n = 0; n < 8; n++) {
      try { return { value: JSON.parse(closeUp(cand)), repaired: true }; } catch (e2) {}
      var cut = cand.lastIndexOf(",");
      if (cut < 1) break;
      cand = cand.slice(0, cut);
    }
    throw new Error("The AI reply could not be read (it may have been cut off). Please try again.");
  }

  async function askJSON(callAI, ai, system, user, maxTokens) {
    var text = await callAI(ai, system, user, maxTokens);
    return parseLoose(text);
  }

  function str(v) { return v === undefined || v === null ? "" : String(v); }
  function clip(t, n) { t = str(t); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, "") + "..." : t; }

  var ROLE_COLORS = { Protagonist: "#10b981", Antagonist: "#ef4444", Supporting: "#3b82f6", Narrator: "#a855f7", Recurring: "#f59e0b" };
  var ROLES = ["Protagonist", "Antagonist", "Supporting", "Narrator", "Recurring"];
  function roleColor(r) { return ROLE_COLORS[r] || "#6b7280"; }

  var LABEL = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 };

  /* ── small UI pieces (same look as the rest of ScriptEngine) ──────────────── */

  function CopyBtn(props) {
    var st = useState(false);
    var done = st[0], setDone = st[1];
    return h("button", {
      onClick: function () { copyText(props.text); setDone(true); setTimeout(function () { setDone(false); }, 1600); },
      style: { background: done ? "#22c55e" : "#374151", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, padding: "3px 10px", cursor: "pointer", transition: "background .2s", whiteSpace: "nowrap" }
    }, done ? (props.ok || "✓ Copied") : (props.label || "📋 Copy"));
  }

  function GhostBtn(props) {
    return h("button", {
      onClick: props.onClick, disabled: props.disabled,
      style: { background: "transparent", border: "1px solid #374151", borderRadius: 6, color: "#6b7280", fontSize: 11, padding: "3px 10px", cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.5 : 1 }
    }, props.children);
  }

  function Pill(props) {
    var on = props.on;
    return h("button", {
      onClick: props.onClick,
      style: { background: on ? "#1e3a5f" : "#111827", border: "1px solid " + (on ? "#3b82f6" : "#374151"), borderRadius: 20, color: on ? "#60a5fa" : "#6b7280", fontSize: 11, padding: "4px 12px", cursor: "pointer" }
    }, props.children);
  }

  function RoleBadge(props) {
    var c = roleColor(props.role);
    return h("span", { style: { background: c + "22", border: "1px solid " + c + "66", color: c, borderRadius: 12, fontSize: 10, fontWeight: 800, padding: "2px 9px", whiteSpace: "nowrap" } }, props.role || "Supporting");
  }

  function ErrorLine(props) {
    if (!props.text) return null;
    return h("div", { style: { background: "#7f1d1d", border: "1px solid #ef4444", borderRadius: 8, color: "#fca5a5", fontSize: 12, padding: "8px 11px", marginTop: 10 } }, "⚠️ " + props.text);
  }

  function PromptBox(props) {
    return h("div", { style: { background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: "10px 13px", color: "#d1d5db", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, props.text);
  }

  /* ════════════════════════════════════════════════════════════════════════════
     1. CHARACTER INTELLIGENCE (story page)
     ════════════════════════════════════════════════════════════════════════════ */

  var CI_SYSTEM =
    "You are a story analyst. Analyse the script and identify ALL named characters who appear in dialogue or scene descriptions. Return ONLY valid JSON (no markdown, no trailing commas, fully closed):\n" +
    '{"characters":[{"name":"EXACT name as in script","role":"Protagonist|Antagonist|Supporting|Narrator|Recurring","appearance":"Physical description for AI image gen: age, build, skin tone, face, clothing, features (2 sentences max)","voiceTone":"Voice tone for TTS: pace, pitch, emotional register (1 sentence)","accent":"Accent, dialect, speech style (1 sentence)","personality":"Core traits, flaws, contradictions (2 sentences max)","want":"What they seek in this story (1 sentence)","fear":"What they want to avoid (1 sentence)"}]}\n\n' +
    "Rules:\n" +
    "- Include EVERY named character who speaks or is described\n" +
    "- Protagonist = main driver; Antagonist = main obstacle; Supporting = aids protagonist/antagonist; Narrator = voice-over only; Recurring = appears repeatedly without main role\n" +
    "- Infer appearance/voice/accent from name, setting, culture, era\n" +
    "- Keep each field concise, quality over length\n" +
    "- Never use em-dashes";

  function scriptText(d) {
    return (d.scenes || []).map(function (s) {
      return "Scene " + s.scene_number + ": " + str(s.scene_title) + "\n" + str(s.scene_description) + "\nDialogue: " + str(s.dialogue);
    }).join("\n\n").slice(0, 14000);
  }

  var CI_ROWS = [
    ["appearance", "👁️ APPEARANCE"],
    ["voiceTone", "🎙️ VOICE TONE"],
    ["accent", "🗣️ ACCENT"],
    ["personality", "🧠 PERSONALITY"],
    ["want", "🎯 WANT"],
    ["fear", "😨 FEAR"]
  ];

  function charToText(c) {
    return str(c.name).toUpperCase() + " (" + str(c.role) + ")\n" + CI_ROWS.map(function (r) { return r[1].replace(/^\S+\s/, "") + ": " + str(c[r[0]]); }).join("\n");
  }

  function CharacterIntelCard(props) {
    var data = props.data;
    var chars = props.chars || [];
    var s1 = useState(false), open = s1[0], setOpen = s1[1];
    var s2 = useState(null), res = s2[0], setRes = s2[1];
    var s3 = useState(false), loading = s3[0], setLoading = s3[1];
    var s4 = useState(""), err = s4[0], setErr = s4[1];
    var s5 = useState(""), msg = s5[0], setMsg = s5[1];

    async function extract() {
      setLoading(true); setErr(""); setMsg("");
      try {
        var r = await askJSON(props.callAI, props.ai, CI_SYSTEM,
          'Story: "' + str(data.title) + '" (' + str(data.genre) + ")\nSynopsis: " + str(data.synopsis) + "\n\nScript:\n" + scriptText(data), 4000);
        var list = Array.isArray(r.value) ? r.value : (r.value && r.value.characters) || [];
        list = list.filter(function (c) { return c && str(c.name).trim(); }).map(function (c) {
          return {
            name: str(c.name).trim(),
            role: ROLES.indexOf(c.role) >= 0 ? c.role : "Supporting",
            appearance: str(c.appearance), voiceTone: str(c.voiceTone), accent: str(c.accent),
            personality: str(c.personality), want: str(c.want), fear: str(c.fear)
          };
        });
        if (!list.length) throw new Error("No named characters were found in this script.");
        setRes(list);
        if (r.repaired) setMsg("The reply was cut short, so the last character may be incomplete. Use Re-analyse for a full pass.");
      } catch (e) {
        setErr(e.message || "Character extraction failed.");
        if (!res) setOpen(false);
      }
      setLoading(false);
    }

    /* Saves into the Character Registry. A name that is already there is never overwritten:
       only its empty fields are filled, so anything you wrote by hand stays as you wrote it. */
    async function saveAll() {
      if (!res || !props.onSaveChars) return;
      var cur = chars.slice();
      var added = 0, filled = 0;
      var base = Date.now();
      res.forEach(function (c, i) {
        var idx = cur.findIndex(function (x) { return str(x.name).trim().toLowerCase() === c.name.toLowerCase(); });
        if (idx >= 0) {
          var merged = Object.assign({}, cur[idx]);
          var changed = false;
          ["role", "appearance", "voiceTone", "accent", "personality", "want", "fear"].forEach(function (k) {
            if (!str(merged[k]).trim() && str(c[k]).trim()) { merged[k] = c[k]; changed = true; }
          });
          cur[idx] = merged;
          if (changed) filled++;
        } else {
          cur.push(Object.assign({ id: base + i }, c));
          added++;
        }
      });
      try {
        await props.onSaveChars(cur);
        setMsg("✓ Saved to Character Registry: " + added + " new, " + filled + " existing filled in.");
      } catch (e) {
        setErr("Could not save to the registry: " + e.message);
      }
    }

    var head = h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
      h("span", { style: Object.assign({ color: "#34d399" }, LABEL, { fontWeight: 800, fontSize: 12 }) }, "👥 Character Intelligence"),
      h("button", {
        onClick: function () { if (!open) { setOpen(true); if (!res) extract(); } else setOpen(false); },
        style: { background: "linear-gradient(135deg,#059669,#10b981)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "5px 13px", cursor: "pointer" }
      }, open ? "Hide" : (res ? "Show ▶" : "Extract Characters ▶")));

    var body = null;
    if (open) {
      body = h("div", { style: { marginTop: 14 } },
        loading && h("div", { style: { color: "#34d399", fontSize: 13 } }, "🔎 Reading the script for characters..."),
        res && !loading && h("div", null,
          h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 } },
            h(CopyBtn, { text: res.map(charToText).join("\n\n"), label: "📋 Copy All Characters", ok: "✓ All Copied" }),
            h(GhostBtn, { onClick: extract }, "↺ Re-analyse"),
            props.onSaveChars && h("button", {
              onClick: saveAll,
              style: { background: "linear-gradient(135deg,#059669,#10b981)", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 12px", cursor: "pointer" }
            }, "→ Save All to Character Registry")),
          res.map(function (c, i) {
            var rc = roleColor(c.role);
            return h("div", { key: c.name + i, style: { border: "1px solid " + rc + "44", borderRadius: 12, marginBottom: 10, overflow: "hidden", background: "#050b18" } },
              h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: rc + "14" } },
                h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
                  h(RoleBadge, { role: c.role }),
                  h("span", { style: { color: "#fff", fontWeight: 900, fontSize: 15, textTransform: "uppercase" } }, c.name)),
                h(CopyBtn, { text: charToText(c) })),
              h("div", { style: { padding: "10px 14px", display: "grid", gridTemplateColumns: "118px 1fr", rowGap: 8, columnGap: 12 } },
                CI_ROWS.map(function (r) {
                  return h(React.Fragment, { key: r[0] },
                    h("div", { style: { color: rc, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 } }, r[1]),
                    h("div", { style: { color: "#d1d5db", fontSize: 13, lineHeight: 1.6 } }, c[r[0]]));
                })));
          })),
        msg && h("div", { style: { color: "#6ee7b7", fontSize: 12, marginTop: 6 } }, msg),
        h(ErrorLine, { text: err }));
    }

    return h("div", { style: { background: "#050f0d", border: "1px solid #10b98144", borderRadius: 14, padding: 16, marginBottom: 18 } }, head, body,
      !open && err && h(ErrorLine, { text: err }));
  }

  /* ════════════════════════════════════════════════════════════════════════════
     2. THUMBNAIL PROMPT CARD (story page)
     ════════════════════════════════════════════════════════════════════════════ */

  var THUMB_SYSTEM =
    "You are an expert thumbnail prompt engineer for AI image generation. Return ONLY valid JSON (no markdown):\n" +
    '{"thumbnail_prompt":"A single highly detailed prompt for MidJourney/Flux/Ideogram, include art style, main character description, key visual moment, emotional tone, composition, lighting, colors, aspect ratio 9:16 vertical for Facebook/Reels","hook_text":"3 to 6 words of text overlay that would appear on the thumbnail, pure curiosity or emotion","color_palette":"3 dominant hex colors that match the emotional tone"}\n' +
    "Never use em-dashes.";

  function storyBrief(d) {
    return 'Story: "' + str(d.title) + '" (' + str(d.genre) + ")\nSynopsis: " + str(d.synopsis) +
      "\nT2I Style: " + str(d.universal_t2i_prompt) +
      "\nKey scenes: " + (d.scenes || []).slice(0, 3).map(function (s) { return str(s.scene_description); }).join(" | ");
  }

  function ThumbnailPromptCard(props) {
    var data = props.data;
    var saved = data && data.thumbnail && data.thumbnail.text ? data.thumbnail.text : "";
    var s1 = useState(false), open = s1[0], setOpen = s1[1];
    var s2 = useState(saved), text = s2[0], setText = s2[1];
    var s3 = useState(false), loading = s3[0], setLoading = s3[1];
    var s4 = useState(""), err = s4[0], setErr = s4[1];
    var s5 = useState(false), cut = s5[0], setCut = s5[1];

    async function gen() {
      setLoading(true); setErr("");
      try {
        var r = await askJSON(props.callAI, props.ai, THUMB_SYSTEM, storyBrief(data), 1500);
        var v = r.value || {};
        var prompt = str(v.thumbnail_prompt).trim();
        if (!prompt) throw new Error("The AI did not return a thumbnail prompt. Please try again.");
        var extra = [];
        if (str(v.hook_text).trim()) extra.push("HOOK TEXT: \"" + str(v.hook_text).trim() + "\"");
        if (str(v.color_palette).trim()) extra.push("COLOR PALETTE: " + str(v.color_palette).trim());
        var full = prompt + (extra.length ? "\n\n" + extra.join("\n") : "");
        setCut(!!r.repaired && extra.length < 2);
        setText(full);
        if (props.onSave) {
          try { await props.onSave(Object.assign({}, data, { thumbnail: { text: full, at: Date.now() } })); } catch (e) {}
        }
      } catch (e) {
        setErr(e.message || "Thumbnail prompt failed.");
        if (!text) setOpen(false);
      }
      setLoading(false);
    }

    return h("div", { style: { background: "#0a0716", border: "1px solid #7c3aed44", borderRadius: 14, padding: 16, marginBottom: 18 } },
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
        h("span", { style: Object.assign({ color: "#a78bfa" }, LABEL, { fontWeight: 800, fontSize: 12 }) }, "🖼️ Thumbnail Prompt"),
        h("button", {
          onClick: function () { if (!open) { setOpen(true); if (!text) gen(); } else setOpen(false); },
          style: { background: "linear-gradient(135deg,#6d28d9,#7c3aed)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 700, padding: "5px 13px", cursor: "pointer" }
        }, open ? "Hide" : (text ? "Show ▶" : "Generate ▶"))),
      open && h("div", { style: { marginTop: 14 } },
        loading && h("div", { style: { color: "#a78bfa", fontSize: 13 } }, "🎨 Designing your thumbnail..."),
        text && !loading && h("div", null,
          h(PromptBox, { text: text }),
          cut && h("div", { style: { color: "#fbbf24", fontSize: 11, marginTop: 6 } }, "The AI reply was cut short, so this prompt may be incomplete. Press Redo for a full version."),
          h("div", { style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" } },
            h(CopyBtn, { text: text, label: "📋 Copy Prompt", ok: "✓ Copied" }),
            h(GhostBtn, { onClick: gen }, "↺ Redo"),
            props.onOpenStudio && h("button", {
              onClick: function () { props.onOpenStudio(storyBrief(data)); },
              style: { background: "#1d4ed8", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 12px", cursor: "pointer" }
            }, "→ Open in Thumbnail Studio"))),
        h(ErrorLine, { text: err })),
      !open && err && h(ErrorLine, { text: err }));
  }

  /* ════════════════════════════════════════════════════════════════════════════
     3. THUMBNAILS TAB (Thumbnail Studio)
     ════════════════════════════════════════════════════════════════════════════ */

  var PLATFORMS = ["Facebook/Reels (9:16)", "YouTube (16:9)", "Instagram Square (1:1)", "YouTube Thumbnail (16:9)"];
  var QUICK_TOOLS = ["MidJourney", "Flux", "Ideogram", "Leonardo.ai", "Kling"];

  function studioSystem(platform) {
    return "You are an expert thumbnail prompt engineer for AI image generation tools like MidJourney, Flux, Ideogram. Return ONLY valid JSON (no markdown):\n" +
      '{"thumbnail_prompt":"Highly detailed image generation prompt, art style, character description, key visual moment, emotional tone, composition, lighting, color grading, aspect ratio for ' + platform + '","hook_text":"3 to 6 words of overlay text, pure curiosity or emotion","color_palette":"3 dominant hex colors matching the emotional tone","negative_prompt":"Elements to exclude from the image generation"}\n' +
      "Never use em-dashes.";
  }

  function ThumbnailsTab(props) {
    var seed = props.seed;
    var s1 = useState(PLATFORMS[0]), platform = s1[0], setPlatform = s1[1];
    var s2 = useState(seed && seed.brief ? seed.brief : ""), brief = s2[0], setBrief = s2[1];
    var s3 = useState(""), out = s3[0], setOut = s3[1];
    var s4 = useState(false), loading = s4[0], setLoading = s4[1];
    var s5 = useState(""), err = s5[0], setErr = s5[1];
    var s6 = useState(false), cut = s6[0], setCut = s6[1];
    var seedN = seed && seed.n ? seed.n : 0;

    useEffect(function () {
      if (seed && seed.brief) { setBrief(seed.brief); setOut(""); setErr(""); setCut(false); }
    }, [seedN]);

    async function gen() {
      if (!brief.trim()) { setErr("Paste a story brief first."); return; }
      setLoading(true); setErr("");
      try {
        var r = await askJSON(props.callAI, props.ai, studioSystem(platform), "Brief: " + brief.trim() + "\nPlatform: " + platform, 1500);
        var v = r.value || {};
        if (!str(v.thumbnail_prompt).trim()) throw new Error("The AI did not return a thumbnail prompt. Please try again.");
        var extra = [];
        if (str(v.hook_text).trim()) extra.push("HOOK TEXT: \"" + str(v.hook_text).trim() + "\"");
        if (str(v.color_palette).trim()) extra.push("COLOR PALETTE: " + str(v.color_palette).trim());
        if (str(v.negative_prompt).trim()) extra.push("NEGATIVE: " + str(v.negative_prompt).trim());
        setCut(!!r.repaired && extra.length < 3);
        setOut(str(v.thumbnail_prompt).trim() + (extra.length ? "\n\n" + extra.join("\n") : ""));
      } catch (e) {
        setErr(e.message || "Thumbnail prompt failed.");
      }
      setLoading(false);
    }

    return h("div", null,
      h("div", { style: Object.assign({ color: "#9ca3af", marginBottom: 16, fontSize: 12 }, LABEL) }, "Generate optimised thumbnail prompts for any platform"),
      h("div", { style: { background: "linear-gradient(135deg,#1f2937,#111827)", border: "1px solid #7c3aed55", borderRadius: 16, padding: 20, marginBottom: 18 } },
        h("div", { style: Object.assign({ color: "#a78bfa", marginBottom: 14, fontWeight: 800, fontSize: 12 }, LABEL) }, "🖼️ Thumbnail Brief"),
        h("div", { style: Object.assign({ color: "#9ca3af", marginBottom: 6, fontSize: 10 }, LABEL) }, "Platform / aspect ratio"),
        h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 } },
          PLATFORMS.map(function (p) { return h(Pill, { key: p, on: platform === p, onClick: function () { setPlatform(p); } }, p); })),
        h("div", { style: Object.assign({ color: "#9ca3af", marginBottom: 6, fontSize: 10 }, LABEL) }, "Story / content brief"),
        h("textarea", {
          value: brief, rows: 5,
          onChange: function (e) { setBrief(e.target.value); },
          placeholder: "Paste your story title, genre, synopsis, key visual moment, character descriptions...",
          style: { width: "100%", background: "#0f172a", border: "1px solid #374151", borderRadius: 10, color: "#e5e7eb", fontSize: 14, padding: "12px 14px", lineHeight: 1.7, resize: "vertical", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }
        }),
        h("button", {
          onClick: gen, disabled: loading,
          style: { marginTop: 14, background: "linear-gradient(135deg,#6d28d9,#7c3aed)", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 800, padding: "11px 22px", cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1 }
        }, loading ? "⏳ Generating..." : "🖼️ Generate Thumbnail Prompt"),
        h(ErrorLine, { text: err })),
      out && h("div", { style: { background: "#0a0716", border: "1px solid #7c3aed44", borderRadius: 14, padding: 16, marginBottom: 18 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
          h("span", { style: Object.assign({ color: "#a78bfa", fontWeight: 800, fontSize: 12 }, LABEL) }, "✨ Generated Thumbnail Prompt"),
          h("div", { style: { display: "flex", gap: 8 } }, h(CopyBtn, { text: out, label: "📋 Copy Prompt" }), h(GhostBtn, { onClick: gen, disabled: loading }, "↺ Redo"))),
        h(PromptBox, { text: out }),
        cut && h("div", { style: { color: "#fbbf24", fontSize: 11, marginTop: 6 } }, "The AI reply was cut short, so this prompt may be incomplete. Press Redo for a full version."),
        h("div", { style: { marginTop: 12 } },
          h("div", { style: Object.assign({ color: "#6b7280", fontSize: 10, marginBottom: 6, fontWeight: 700 }, LABEL) }, "Quick edit, paste directly into:"),
          h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            QUICK_TOOLS.map(function (t) { return h("span", { key: t, style: { background: "#1f2937", border: "1px solid #374151", borderRadius: 20, color: "#9ca3af", fontSize: 11, padding: "3px 11px" } }, t); })))));
  }

  /* ════════════════════════════════════════════════════════════════════════════
     4. AVATARS TAB
     ════════════════════════════════════════════════════════════════════════════ */

  var ART_STYLES = ["Cinematic realism", "Anime / illustrated", "3D rendered", "Oil painting", "Graphic novel", "Photorealistic portrait"];

  function avatarSystem(style) {
    return "You are an expert character portrait prompt engineer. Return ONLY valid JSON (no markdown):\n" +
      '{"portrait_prompt":"Detailed image generation prompt for a character portrait, physical description, expression, wardrobe, lighting, art style, camera angle, mood, optimised for ' + style + '","negative_prompt":"Elements to avoid","style_notes":"Art direction notes for consistency across all portraits of this character"}\n' +
      "Keep portrait_prompt under 180 words. Never use em-dashes.";
  }

  function avatarUser(c, style) {
    var lines = ["Character: " + str(c.name) + " (" + str(c.role) + ")"];
    var ident = [c.age && (c.age + "-year-old"), c.gender, c.ethnicity, c.nationality && "(" + c.nationality + ")"].filter(Boolean).join(" ");
    if (ident) lines.push("Identity: " + ident);
    if (str(c.occupation).trim()) lines.push("Occupation: " + c.occupation);
    lines.push("Appearance: " + str(c.appearance));
    if (str(c.wardrobe).trim()) lines.push("Wardrobe: " + c.wardrobe);
    if (str(c.emotionalState).trim()) lines.push("Emotional state: " + c.emotionalState);
    lines.push("Personality: " + str(c.personality));
    lines.push("Voice/Accent: " + str(c.voiceTone) + ", " + str(c.accent));
    lines.push("Art style: " + style);
    return lines.join("\n");
  }

  function AvatarsTab(props) {
    var chars = props.chars || [];
    var s1 = useState(ART_STYLES[0]), style = s1[0], setStyle = s1[1];
    var s2 = useState({}), busy = s2[0], setBusy = s2[1];
    var s3 = useState({}), errs = s3[0], setErrs = s3[1];
    var s4 = useState(""), progress = s4[0], setProgress = s4[1];
    var ref = useRef(chars);
    useEffect(function () { ref.current = chars; }, [chars]);

    function setFlag(id, v) { setBusy(function (b) { var n = Object.assign({}, b); n[id] = v; return n; }); }
    function setErr(id, v) { setErrs(function (b) { var n = Object.assign({}, b); n[id] = v; return n; }); }

    async function genOne(c) {
      setFlag(c.id, true); setErr(c.id, "");
      try {
        var r = await askJSON(props.callAI, props.ai, avatarSystem(style), avatarUser(c, style), 1500);
        var v = r.value || {};
        if (!str(v.portrait_prompt).trim()) throw new Error("The AI did not return a portrait prompt. Please try again.");
        var extra = [];
        if (str(v.negative_prompt).trim()) extra.push("NEGATIVE: " + str(v.negative_prompt).trim());
        if (str(v.style_notes).trim()) extra.push("STYLE NOTES: " + str(v.style_notes).trim());
        var full = str(v.portrait_prompt).trim() + (extra.length ? "\n\n" + extra.join("\n") : "");
        var cut = !!r.repaired && extra.length < 2;
        var next = ref.current.map(function (x) { return x.id === c.id ? Object.assign({}, x, { avatarPrompt: full, avatarStyle: style, avatarCut: cut }) : x; });
        ref.current = next;
        await props.onSave(next);
      } catch (e) {
        setErr(c.id, e.message || "Avatar prompt failed.");
      }
      setFlag(c.id, false);
    }

    async function genAll() {
      var list = ref.current.slice();
      for (var i = 0; i < list.length; i++) {
        setProgress("Generating " + (i + 1) + " of " + list.length + ": " + str(list[i].name));
        await genOne(list[i]);
      }
      setProgress("");
    }

    if (!chars.length) {
      return h("div", { style: { background: "#0b1220", border: "1px solid #1f2937", borderRadius: 16, textAlign: "center", padding: "44px 20px" } },
        h("div", { style: { fontSize: 38, marginBottom: 10, opacity: 0.6 } }, "👥"),
        h("div", { style: { color: "#9ca3af", fontSize: 15, marginBottom: 6 } }, "No characters in your registry yet."),
        h("div", { style: { color: "#4b5563", fontSize: 12 } }, "Add characters in the Characters tab first, then generate their avatar prompts here."));
    }

    var anyBusy = Object.keys(busy).some(function (k) { return busy[k]; });

    return h("div", null,
      h("div", { style: Object.assign({ color: "#9ca3af", marginBottom: 16, fontSize: 12 }, LABEL) }, chars.length + " character" + (chars.length !== 1 ? "s" : "") + " in registry, generate portrait prompts for each"),
      h("div", { style: { background: "linear-gradient(135deg,#1f2937,#111827)", border: "1px solid #374151", borderRadius: 14, padding: 18, marginBottom: 20 } },
        h("div", { style: Object.assign({ color: "#f59e0b", fontWeight: 800, fontSize: 12, marginBottom: 12 }, LABEL) }, "🎨 Portrait Art Style"),
        h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 } },
          ART_STYLES.map(function (a) { return h(Pill, { key: a, on: style === a, onClick: function () { setStyle(a); } }, a); })),
        h("button", {
          onClick: genAll, disabled: anyBusy,
          style: { background: "linear-gradient(135deg,#f59e0b,#ef4444)", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 800, padding: "11px 22px", cursor: anyBusy ? "default" : "pointer", opacity: anyBusy ? 0.7 : 1 }
        }, "⚡ Generate All Avatar Prompts"),
        progress && h("div", { style: { color: "#fbbf24", fontSize: 12, marginTop: 10 } }, "⏳ " + progress)),
      chars.map(function (c) {
        var rc = roleColor(c.role);
        var isBusy = !!busy[c.id];
        return h("div", { key: c.id, style: { border: "1px solid " + rc + "44", borderRadius: 14, marginBottom: 14, overflow: "hidden", background: "#070d1a" } },
          h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: rc + "14" } },
            h("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
              h("div", { style: { width: 42, height: 42, borderRadius: 10, background: rc, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 } }, "👤"),
              h("div", null,
                h("div", { style: { color: "#fff", fontWeight: 900, fontSize: 16, textTransform: "uppercase" } }, c.name),
                h("div", { style: { marginTop: 4 } }, h(RoleBadge, { role: c.role })))),
            h("button", {
              onClick: function () { genOne(c); }, disabled: isBusy,
              style: { background: rc, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 800, padding: "8px 16px", cursor: isBusy ? "default" : "pointer", opacity: isBusy ? 0.7 : 1 }
            }, isBusy ? "⏳ Generating..." : (c.avatarPrompt ? "↺ Regenerate" : "✨ Generate Avatar Prompt"))),
          h("div", { style: { padding: "12px 16px" } },
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px", fontSize: 12, lineHeight: 1.7, color: "#d1d5db" } },
              [["APPEARANCE", c.appearance], ["VOICE", c.voiceTone], ["ACCENT", c.accent], ["PERSONALITY", c.personality]].map(function (r) {
                return h("div", { key: r[0] }, h("span", { style: { color: rc, fontSize: 10, fontWeight: 800 } }, r[0] + ": "), clip(r[1], 90));
              })),
            c.avatarPrompt
              ? h("div", { style: { marginTop: 12 } },
                  h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 } },
                    h("span", { style: Object.assign({ color: rc, fontSize: 10, fontWeight: 800 }, LABEL) }, "Avatar prompt" + (c.avatarStyle ? " (" + c.avatarStyle + ")" : "")),
                    h(CopyBtn, { text: c.avatarPrompt })),
                  h(PromptBox, { text: c.avatarPrompt }),
                  c.avatarCut && h("div", { style: { color: "#fbbf24", fontSize: 11, marginTop: 6 } }, "The AI reply was cut short, so this prompt may be incomplete. Press Regenerate for a full version."))
              : h("div", { style: { color: "#374151", fontSize: 12, fontStyle: "italic", marginTop: 12 } }, "Click \"Generate Avatar Prompt\" to create a portrait prompt for " + str(c.name).toUpperCase()),
            h(ErrorLine, { text: errs[c.id] })));
      }));
  }

  window.SEExtras = {
    version: "1.0.0",
    CharacterIntelCard: CharacterIntelCard,
    ThumbnailPromptCard: ThumbnailPromptCard,
    ThumbnailsTab: ThumbnailsTab,
    AvatarsTab: AvatarsTab,
    parseLoose: parseLoose
  };
})();
