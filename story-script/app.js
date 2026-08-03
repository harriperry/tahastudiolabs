const {
  useState,
  useRef,
  useEffect
} = React;
const STAGES = [{
  label: "Scripted",
  color: "#4b5563",
  icon: "📝"
}, {
  label: "Image Done",
  color: "#3b82f6",
  icon: "🖼️"
}, {
  label: "Video Done",
  color: "#f59e0b",
  icon: "🎥"
}, {
  label: "VO Done",
  color: "#a855f7",
  icon: "🎙️"
}, {
  label: "Edited",
  color: "#10b981",
  icon: "✂️"
}, {
  label: "Published",
  color: "#22c55e",
  icon: "🚀"
}];
const GENRE_COLORS = {
  Drama: "#a855f7",
  Thriller: "#ef4444",
  Comedy: "#f59e0b",
  Romance: "#ec4899",
  Action: "#f97316",
  Horror: "#dc2626",
  "Sci-Fi": "#3b82f6",
  Fantasy: "#10b981",
  Mystery: "#06b6d4"
};
const genreColor = (g = "") => {
  const m = Object.keys(GENRE_COLORS).find(k => g.toLowerCase().includes(k.toLowerCase()));
  return m ? GENRE_COLORS[m] : "#6b7280";
};
const cp = t => navigator.clipboard.writeText(t).catch(() => {});
const ANTHROPIC_HEADERS = key => ({
  "Content-Type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true"
});
const ANTHROPIC_MODEL = "claude-sonnet-5";

/* ── Accounts & Pro gating ────────────────────────────────────────────────
   Reuses the same shared TAHA Studio Labs account system as ScriptForge —
   one login, cookie-based session, same Supabase project. Tier is a single
   pro/free flag per account, so a paid ScriptEngine subscription also
   unlocks ScriptForge Pro and vice versa (one TAHA account, every product). */
const SE_PRO_MONTHLY_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_iPXfCYT9TLO24z43QQcIkIe7ODOa145blAGYT3iOYaa";
async function api(path, body) {
  try {
    const res = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    return {
      ok: res.ok,
      status: res.status,
      data
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null
    };
  }
}

// Anthropic returns a JSON error object (no "content" field) on auth failures,
// bad model names, rate limits, etc. Surface that message instead of letting
// JSON.parse blow up on an empty/unexpected body with a cryptic error.
async function anthropicJSON(res) {
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Anthropic returned an unreadable response (HTTP ${res.status}).`);
  }
  if (!res.ok || json?.type === "error") {
    throw new Error(json?.error?.message || `Anthropic API error (HTTP ${res.status}).`);
  }
  return json;
}

/* ── Multi-provider AI call ───────────────────────────────────────────────
   ScriptEngine supports Anthropic Claude and xAI Grok as interchangeable
   text-generation providers. callAI() takes a system prompt + user message
   and returns plain text, branching on whichever provider is active so the
   four call sites (generate, addTwoScenes, regenScene, FBGen) don't each
   need their own provider-switch logic. */
const GROK_MODEL = "grok-4-fast";
/* Both providers now go through the same "/api/ai-relay" same-origin relay function
   (functions/api/ai-relay.js). Grok used to call https://api.x.ai/v1/chat/completions
   directly from the browser here, which never actually worked: xAI's API has no CORS
   headers permitting a direct browser fetch from a third-party origin, so the request
   was blocked before any response came back, surfacing as a bare "Failed to fetch"
   regardless of whether the key was valid or paid. Routing through the relay (the key
   is forwarded for this one request only, never stored or logged server-side) fixes
   that the same way it was already fixed for Anthropic below. */
async function callAI({
  provider,
  anthropicKey,
  grokKey
}, system, userText, maxTokens) {
  const isGrok = provider === "grok";
  const apiKey = isGrok ? grokKey : anthropicKey;
  if (!apiKey) throw new Error(`Add your ${isGrok ? "Grok (xAI)" : "Anthropic"} API key in Settings first.`);

  const res = await fetch("/api/ai-relay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider: isGrok ? "grok" : "anthropic",
      apiKey,
      model: isGrok ? GROK_MODEL : ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{
        role: "user",
        content: userText
      }]
    })
  });
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`Relay returned an unreadable response (HTTP ${res.status}).`);
  }
  if (!res.ok || !json?.ok) throw new Error(json?.error || `${isGrok ? "Grok" : "Anthropic"} API error (HTTP ${res.status}).`);
  return json.text || "";
}
const buildSystemPrompt = (context, chars) => {
  const charBlock = chars?.length ? `\n## CHARACTER REGISTRY — USE CONSISTENTLY IN ALL SCENES\n${chars.map(c => `- ${c.name} (${c.role}): ${c.appearance}. Voice: ${c.voiceTone}. Accent: ${c.accent}. Personality: ${c.personality}.`).join("\n")}\n` : "";
  return `You are an elite story writer, cinematographer, and AI video production expert specialising in short-form Facebook video content. ${charBlock}${context ? `\n## ESTABLISHED STORY WORLD — TREAT AS CANON\n${context}\n` : ""}
## MANDATORY STORYTELLING RULES
1. HOOK FIRST: Open every story by revealing the emotional endpoint or consequence BEFORE telling the story. The audience must feel the weight of what happened before they see how. Spark instant curiosity that compels them to watch every scene. Example: begin with the feeling — "This is the moment everything changed..." — then take them back.
2. PRESENT TENSE: Write ALL events in present tense even when describing the past. "She walks in" not "She walked in." Always.
3. NATURAL DIALOGUE: Write like two real people talking in a real place. No AI patterns. No perfect sentences. Include natural hesitations, reactions, interruptions. It must never sound scripted.
4. SOUND EFFECTS & REACTIONS: Every scene must feel alive. Include ambient SFX inside scene_description as [SFX: description] — footsteps on tile, door clicking shut, distant crowd, wind through a window, a chair scraping. Also populate the sfx_prompt field with precise audio production directions. SFX must be subtle — never louder than the dialogue or story emotion.
5. PAUSES: Use "..." in dialogue for natural breath and timing. NEVER use em-dashes (—) inside dialogue or sentences. Not once.
6. CHARACTER REACTIONS: Every scene must include at least one visible reaction — a flinch, a silence, a laugh, a look away. The body always responds.
7. ENDING WITH REACTION: The final scene closes with a reaction — not an explanation. The audience must feel the story has fully landed. Completion, not abandonment.

## DIALOGUE TIMING — HARD LIMIT: 18 SPOKEN WORDS PER SCENE
At natural conversational pace of 120 words per minute, 9 seconds = exactly 18 spoken words. Count ONLY the words spoken after TTS: labels and after reply colons — NEVER count the tone descriptions inside asterisks. If spoken words exceed 18, cut until they don't. Every word must earn its place.

When given a story idea or production brief, return ONLY a valid JSON object (no markdown, no backticks, no preamble):
{"title":"...","synopsis":"2-3 sentence emotional hook — open with the end feeling first","genre":"Drama/Thriller/etc","universal_t2i_prompt":"[Art style],[characters],[palette],[lighting],[mood],[camera], cinematic, high detail, consistent character design, storyboard sheet","scenes":[{"scene_number":1,"scene_title":"...","scene_description":"Vivid 2-3 sentences: setting, time, mood, atmosphere. Weave in [SFX: ambient sounds] naturally.","dialogue":"[Name] said *(vivid ElevenLabs-ready tone)* TTS: (spoken message — count these words). [Name] replied *(tone and accent)*: (spoken reply — count these words). Total spoken words across both turns must not exceed 18. Use ... for pauses. Never use em-dashes.","sfx_prompt":"Precise sound design brief for this scene: ambient layers, action-triggered SFX, emotional audio cues. Production-ready for audio editors.","i2v_prompt":"Camera movement, scene motion, environmental animation, cinematic technique","kinetic_prompt":"Character gestures, facial expressions, physical actions, emotional physicality — include reactions","continuity_prompt":"Bridge to next scene: lighting transition, emotional arc, camera handoff, mood shift"}]}
CRITICAL: All 7 storytelling rules are non-negotiable. 18 spoken words hard limit. SFX in every scene. Present tense throughout. No em-dashes ever. End on a reaction. Optimised for Facebook vertical video.`;
};
const extractSpoken = d => {
  if (!d || d.toUpperCase().startsWith("SILENT")) return null;
  return d.replace(/\*[^*]+\*/g, "").replace(/TTS:\s*/gi, "").replace(/\b\w[\w ]*\b\s+said\s*/gi, "").replace(/\b\w[\w ]*\b\s+replied\s*/gi, "").replace(/:\s*/g, ". ").replace(/\s+/g, " ").trim();
};
const sceneToText = s => `━━━━━━━━━━━━━━━━━━━━━━━━━
SCENE ${s.scene_number} — ${s.scene_title}
━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 SCENE DESCRIPTION
${s.scene_description}

💬 DIALOGUE (9s)
${s.dialogue}

🎥 I2V PROMPT
${s.i2v_prompt}

🏃 KINETIC PROMPT
${s.kinetic_prompt}

🔗 CONTINUITY PROMPT
${s.continuity_prompt}`;

// ── CopyBtn ───────────────────────────────────────────────────────────────────
const CopyBtn = ({
  text,
  label = "Copy",
  ok = "✓ Copied"
}) => {
  const [c, setC] = useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      cp(text);
      setC(true);
      setTimeout(() => setC(false), 1600);
    },
    style: {
      background: c ? "#22c55e" : "#374151",
      border: "none",
      borderRadius: 6,
      color: "#fff",
      fontSize: 11,
      padding: "3px 10px",
      cursor: "pointer",
      transition: "background .2s",
      whiteSpace: "nowrap"
    }
  }, c ? ok : label);
};

// ── TTS Copy Button ───────────────────────────────────────────────────────────
const TTSPlayer = ({
  dialogue
}) => {
  const [state, setState] = useState("idle"); // idle | copied | silent
  const text = extractSpoken(dialogue);
  const handleCopy = () => {
    if (!text) {
      setState("silent");
      setTimeout(() => setState("idle"), 2000);
      return;
    }
    cp(text);
    setState("copied");
    setTimeout(() => setState("idle"), 2000);
  };
  const colors = {
    idle: {
      bg: "#1e3a5f",
      border: "#3b82f6",
      color: "#60a5fa"
    },
    copied: {
      bg: "#064e3b",
      border: "#10b981",
      color: "#34d399"
    },
    silent: {
      bg: "#1f2937",
      border: "#4b5563",
      color: "#6b7280"
    }
  };
  const s = colors[state];
  const labels = {
    idle: "🎙️ Copy TTS",
    copied: "✓ Copied!",
    silent: "Silent scene"
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: handleCopy,
    style: {
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 6,
      color: s.color,
      fontSize: 11,
      padding: "3px 10px",
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all .2s"
    }
  }, labels[state]));
};

// ── Tracker Row ───────────────────────────────────────────────────────────────
const TrackerRow = ({
  sceneNum,
  tracker,
  onChange
}) => {
  const stage = tracker[sceneNum] ?? 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      flexWrap: "wrap",
      paddingTop: 10,
      borderTop: "1px solid #1f2937",
      marginTop: 6
    }
  }, STAGES.map((s, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => onChange(sceneNum, i),
    style: {
      background: stage === i ? s.color : stage > i ? s.color + "44" : "#1f2937",
      border: `1px solid ${stage >= i ? s.color : "#374151"}`,
      borderRadius: 20,
      color: stage >= i ? "#fff" : "#6b7280",
      fontSize: 10,
      fontWeight: stage === i ? 800 : 400,
      padding: "3px 9px",
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all .15s"
    }
  }, s.icon, " ", s.label)));
};

// ── Scene Card ──────────────────────────────────────────────────────────────────
const SceneCard = ({
  scene,
  total,
  tracker,
  onStageChange,
  onRegen,
  elApiKey,
  elVoiceId
}) => {
  const pal = ["#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ef4444", "#06b6d4", "#f97316", "#ec4899"];
  const c = pal[(scene.scene_number - 1) % pal.length];
  const [open, setOpen] = useState(true);
  const [regen, setRegen] = useState(false);
  const doRegen = async () => {
    setRegen(true);
    await onRegen(scene.scene_number);
    setRegen(false);
  };
  const Row = ({
    icon,
    label,
    value
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: c,
      textTransform: "uppercase",
      letterSpacing: 1
    }
  }, icon, " ", label), /*#__PURE__*/React.createElement(CopyBtn, {
    text: value
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#070d1a",
      border: `1px solid ${c}22`,
      borderRadius: 8,
      padding: "10px 13px",
      color: "#d1d5db",
      fontSize: 13,
      lineHeight: 1.6,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word"
    }
  }, value));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: `1px solid ${c}55`,
      borderRadius: 14,
      marginBottom: 16,
      overflow: "hidden",
      boxShadow: `0 0 18px ${c}0d`
    }
  }, scene.direction && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#2e1065",
      borderBottom: "1px solid #7c3aed66",
      padding: "8px 15px",
      display: "flex",
      gap: 8,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "🎯"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#c4b5fd",
      fontWeight: 800,
      fontSize: 11,
      textTransform: "uppercase",
      letterSpacing: 0.5
    }
  }, "Writer's Direction: "), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#ddd6fe",
      fontSize: 12,
      lineHeight: 1.5
    }
  }, scene.direction))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: `linear-gradient(135deg,${c}28,#1a2035)`,
      padding: "12px 15px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      cursor: "pointer"
    },
    onClick: () => setOpen(o => !o)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: c,
      color: "#000",
      fontWeight: 900,
      borderRadius: 8,
      width: 32,
      height: 32,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13,
      flexShrink: 0
    }
  }, scene.scene_number), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fff",
      fontWeight: 800,
      fontSize: 14
    }
  }, scene.scene_title), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 10
    }
  }, "Scene ", scene.scene_number, " of ", total, " · ", STAGES[tracker[scene.scene_number] ?? 0].icon, " ", STAGES[tracker[scene.scene_number] ?? 0].label))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 5,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(TTSPlayer, {
    dialogue: scene.dialogue
  }), /*#__PURE__*/React.createElement("button", {
    onClick: doRegen,
    disabled: regen,
    style: {
      background: regen ? "#374151" : "#1a2035",
      border: `1px solid ${c}88`,
      borderRadius: 6,
      color: regen ? "#6b7280" : c,
      fontSize: 11,
      padding: "3px 9px",
      cursor: regen ? "not-allowed" : "pointer",
      whiteSpace: "nowrap"
    }
  }, regen ? "⏳ Rewriting..." : "🔄 Regen"), /*#__PURE__*/React.createElement(CopyBtn, {
    text: sceneToText(scene),
    label: "📋 Copy",
    ok: "✓!"
  }), /*#__PURE__*/React.createElement("span", {
    onClick: () => setOpen(o => !o),
    style: {
      color: c,
      fontSize: 16,
      cursor: "pointer"
    }
  }, open ? "▲" : "▼"))), open && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "15px 15px 8px",
      background: "#0a1020"
    }
  }, /*#__PURE__*/React.createElement(Row, {
    icon: "🎬",
    label: "Scene Description",
    value: scene.scene_description
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: c,
      textTransform: "uppercase",
      letterSpacing: 1
    }
  }, "💬 Dialogue"), (() => {
    const spoken = extractSpoken(scene.dialogue);
    if (!spoken) return null;
    const words = spoken.split(/\s+/).filter(Boolean).length;
    const secs = (words / 2).toFixed(1);
    const ok = words <= 18;
    return /*#__PURE__*/React.createElement("span", {
      style: {
        background: ok ? "#064e3b" : "#7f1d1d",
        color: ok ? "#34d399" : "#fca5a5",
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 700,
        padding: "1px 8px",
        whiteSpace: "nowrap"
      }
    }, words, "w · ~", secs, "s");
  })()), /*#__PURE__*/React.createElement(CopyBtn, {
    text: scene.dialogue
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: `linear-gradient(135deg,${c}18,#0d1a2e)`,
      border: `1px solid ${c}55`,
      borderRadius: 10,
      padding: "12px 14px",
      color: "#fff",
      fontSize: 14,
      lineHeight: 1.7,
      fontStyle: "italic",
      fontWeight: 600
    }
  }, "\"", scene.dialogue, "\""), /*#__PURE__*/React.createElement(TTSPlayer, {
    dialogue: scene.dialogue
  })), scene.sfx_prompt && /*#__PURE__*/React.createElement(Row, {
    icon: "🔊",
    label: "SFX / Sound Design",
    value: scene.sfx_prompt
  }), /*#__PURE__*/React.createElement(Row, {
    icon: "🎥",
    label: "I2V Prompt",
    value: scene.i2v_prompt
  }), /*#__PURE__*/React.createElement(Row, {
    icon: "🏃",
    label: "Kinetic Prompt",
    value: scene.kinetic_prompt
  }), /*#__PURE__*/React.createElement(Row, {
    icon: "🔗",
    label: "Continuity Prompt",
    value: scene.continuity_prompt
  }), /*#__PURE__*/React.createElement(TrackerRow, {
    sceneNum: scene.scene_number,
    tracker: tracker,
    onChange: onStageChange
  })));
};

// ── Facebook Generator ────────────────────────────────────────────────────────
const FBGen = ({
  data,
  ai
}) => {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);
  const gen = async () => {
    setLoading(true);
    try {
      const text = await callAI(ai, `You are a Facebook viral content strategist. Return ONLY valid JSON (no markdown): {"hook":"Single scroll-stopping opening line — max 12 words, pure emotion or curiosity, no hashtags","caption":"3-4 short paragraphs, emotional storytelling tone, ends with a question to drive comments","cta":"One strong call-to-action line","hashtags":"10 relevant hashtags as a single string"}`, `Story: "${data.title}" (${data.genre})\nSynopsis: ${data.synopsis}\n\nWrite a viral Facebook video post.`, 1000);
      setRes(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch (e) {
      alert("Failed: " + e.message);
      setOpen(false);
    }
    setLoading(false);
  };
  const fullPost = res ? `${res.hook}\n\n${res.caption}\n\n${res.cta}\n\n${res.hashtags}` : "";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#070f1f",
      border: "1px solid #1d4ed844",
      borderRadius: 14,
      padding: 16,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#60a5fa",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1
    }
  }, "📱 Facebook Caption & Hook"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (!open) {
        setOpen(true);
        if (!res) gen();
      } else setOpen(false);
    },
    style: {
      background: "linear-gradient(135deg,#1d4ed8,#2563eb)",
      border: "none",
      borderRadius: 8,
      color: "#fff",
      fontSize: 12,
      fontWeight: 700,
      padding: "5px 13px",
      cursor: "pointer"
    }
  }, open ? "Hide" : "Generate Post ▶")), open && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, loading && /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#60a5fa",
      fontSize: 13
    }
  }, "✍️ Crafting your Facebook post..."), res && !loading && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, [{
    l: "🪝 Hook",
    v: res.hook
  }, {
    l: "📝 Caption",
    v: res.caption
  }, {
    l: "📣 CTA",
    v: res.cta
  }, {
    l: "# Hashtags",
    v: res.hashtags
  }].map(({
    l,
    v
  }) => /*#__PURE__*/React.createElement("div", {
    key: l
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#60a5fa",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1
    }
  }, l), /*#__PURE__*/React.createElement(CopyBtn, {
    text: v
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#111827",
      border: "1px solid #1f2937",
      borderRadius: 8,
      padding: "9px 12px",
      color: "#d1d5db",
      fontSize: 13,
      lineHeight: 1.6,
      whiteSpace: "pre-wrap"
    }
  }, v))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      justifyContent: "flex-end",
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement(CopyBtn, {
    text: fullPost,
    label: "📋 Copy Full Post",
    ok: "✓ Post Copied!"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: gen,
    style: {
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 6,
      color: "#6b7280",
      fontSize: 11,
      padding: "3px 10px",
      cursor: "pointer"
    }
  }, "↺ Redo")))));
};

// ── Story View ────────────────────────────────────────────────────────────────
const StoryView = ({
  data,
  onSave,
  elApiKey,
  elVoiceId,
  ai,
  tracker,
  onStageChange
}) => {
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState("");
  const [rawView, setRawView] = useState(false);
  const [showAddDirection, setShowAddDirection] = useState(false);
  const [direction, setDirection] = useState("");
  const enterEdit = () => {
    const d = {};
    data.scenes?.forEach(s => {
      d[s.scene_number] = s.dialogue;
    });
    setDrafts(d);
    setEditMode(true);
    setSaved(false);
  };
  const saveEdits = async () => {
    setSaving(true);
    await onSave({
      ...data,
      scenes: data.scenes.map(s => ({
        ...s,
        dialogue: drafts[s.scene_number] ?? s.dialogue
      }))
    });
    setSaving(false);
    setSaved(true);
    setEditMode(false);
  };
  const addTwoScenes = async () => {
    const dir = direction.trim();
    setAdding(true);
    setAddMsg("✍️ Writing 2 new scenes...");
    const sum = data.scenes.map(s => `Scene ${s.scene_number} — ${s.scene_title}: ${s.scene_description}`).join("\n");
    const last = data.scenes[data.scenes.length - 1];
    const next = (last?.scene_number || data.scenes.length) + 1;
    try {
      const text = await callAI(ai, `Write exactly 2 continuation scenes. Return ONLY a JSON array of 2 objects (no markdown): [{"scene_number":${next},"scene_title":"...","scene_description":"...","dialogue":"[Name] said *(tone)* TTS: (msg). [Name] replied *(tone)*: (reply).","i2v_prompt":"...","kinetic_prompt":"...","continuity_prompt":"..."}] Numbers start at ${next}. Match story's arc and visual style exactly.${dir ? ` The writer has given specific direction for these 2 scenes — follow it closely and make sure the scenes clearly deliver on it: "${dir}"` : ""}`, `Story: "${data.title}" (${data.genre})\nSynopsis: ${data.synopsis}\n\nScenes:\n${sum}\n\nLast continuity: ${last?.continuity_prompt || "N/A"}${dir ? `\n\nDirection for these 2 new scenes (from the writer): ${dir}` : ""}`, 3000);
      const ns = JSON.parse(text.replace(/```json|```/g, "").trim());
      if (dir && ns[0]) ns[0] = {
        ...ns[0],
        direction: dir
      };
      await onSave({
        ...data,
        scenes: [...data.scenes, ...ns]
      });
      setAddMsg("✅ 2 scenes added!");
      setTimeout(() => setAddMsg(""), 3000);
      setShowAddDirection(false);
      setDirection("");
    } catch (e) {
      setAddMsg("⚠️ " + e.message.slice(0, 50));
      setTimeout(() => setAddMsg(""), 4000);
    }
    setAdding(false);
  };
  const regenScene = async num => {
    const s = data.scenes.find(x => x.scene_number === num);
    const prev = data.scenes.find(x => x.scene_number === num - 1);
    try {
      const text = await callAI(ai, `Rewrite ONE scene. Return ONLY a single JSON scene object (no markdown, no array): {"scene_number":${num},"scene_title":"...","scene_description":"...","dialogue":"[Name] said *(tone)* TTS: (msg). [Name] replied *(tone)*: (reply).","i2v_prompt":"...","kinetic_prompt":"...","continuity_prompt":"..."}`, `Story: "${data.title}" (${data.genre})\nSynopsis: ${data.synopsis}\nPrev continuity: ${prev?.continuity_prompt || "N/A"}\n\nRewrite scene ${num}: "${s?.scene_title}" — fresh approach, same story position.`, 1500);
      const ns = JSON.parse(text.replace(/```json|```/g, "").trim());
      await onSave({
        ...data,
        scenes: data.scenes.map(x => x.scene_number === num ? ns : x)
      });
    } catch (e) {
      alert("Regen failed: " + e.message);
    }
  };
  const activeData = editMode ? {
    ...data,
    scenes: data.scenes.map(s => ({
      ...s,
      dialogue: drafts[s.scene_number] ?? s.dialogue
    }))
  } : data;
  const fullScript = `${activeData.title.toUpperCase()}\n${activeData.genre} · ${activeData.scenes?.length} Scenes\n\n${activeData.synopsis}\n\n🖼️ UNIVERSAL T2I PROMPT\n${activeData.universal_t2i_prompt}\n\n${"━".repeat(28)}\n\n${activeData.scenes?.map(s => sceneToText(s)).join("\n\n")}`;
  const published = Object.values(tracker).filter(v => v === 5).length;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#1e1b4b,#111827)",
      border: "1px solid #4338ca44",
      borderRadius: 16,
      padding: 20,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      flexWrap: "wrap",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#818cf8",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 3
    }
  }, data.genre), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 20,
      fontWeight: 900,
      color: "#fff"
    }
  }, data.title)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: "#4338ca",
      color: "#fff",
      borderRadius: 20,
      padding: "3px 12px",
      fontSize: 11,
      fontWeight: 700
    }
  }, data.scenes?.length, " Scenes"), !editMode && !adding && /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAddDirection(v => !v),
    style: {
      background: showAddDirection ? "#4338ca" : "linear-gradient(135deg,#7c3aed,#4338ca)",
      border: showAddDirection ? "1px solid #a78bfa" : "none",
      borderRadius: 8,
      color: "#fff",
      fontSize: 11,
      fontWeight: 700,
      padding: "5px 11px",
      cursor: "pointer"
    }
  }, "➕ Add 2"), !editMode && /*#__PURE__*/React.createElement("button", {
    onClick: enterEdit,
    style: {
      background: "#1e3a5f",
      border: "1px solid #3b82f6",
      borderRadius: 8,
      color: "#60a5fa",
      fontSize: 11,
      fontWeight: 700,
      padding: "5px 11px",
      cursor: "pointer"
    }
  }, "✏️ Edit Dialogues"), editMode && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: saveEdits,
    disabled: saving,
    style: {
      background: "linear-gradient(135deg,#10b981,#059669)",
      border: "none",
      borderRadius: 8,
      color: "#fff",
      fontSize: 11,
      fontWeight: 700,
      padding: "5px 11px",
      cursor: "pointer"
    }
  }, saving ? "Saving..." : "💾 Save"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setEditMode(false),
    style: {
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#9ca3af",
      fontSize: 11,
      padding: "4px 9px",
      cursor: "pointer"
    }
  }, "Cancel")), !editMode && /*#__PURE__*/React.createElement("button", {
    onClick: () => setRawView(v => !v),
    style: {
      background: rawView ? "#1e3a5f" : "#1f2937",
      border: `1px solid ${rawView ? "#3b82f6" : "#374151"}`,
      borderRadius: 8,
      color: rawView ? "#60a5fa" : "#9ca3af",
      fontSize: 11,
      fontWeight: 700,
      padding: "5px 11px",
      cursor: "pointer"
    }
  }, rawView ? "🎨 View Formatted" : "📄 View Raw Markdown"), !editMode && /*#__PURE__*/React.createElement(CopyBtn, {
    text: fullScript,
    label: "📋 Full Script",
    ok: "✓ Copied!"
  }))), /*#__PURE__*/React.createElement("p", {
    style: {
      color: "#a5b4fc",
      marginTop: 10,
      marginBottom: 0,
      lineHeight: 1.65,
      fontSize: 13
    }
  }, data.synopsis), (saved || addMsg) && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 7,
      fontSize: 12,
      fontWeight: 700,
      color: addMsg?.startsWith("⚠️") ? "#fca5a5" : "#34d399"
    }
  }, saved && !addMsg ? "✅ Dialogues saved." : addMsg), data.scenes?.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      display: "flex",
      gap: 5,
      alignItems: "center",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#6b7280",
      fontSize: 10,
      fontWeight: 700
    }
  }, "PROGRESS:"), STAGES.map((s, i) => {
    const cnt = Object.values(tracker).filter(v => v === i).length;
    return cnt > 0 ? /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        background: s.color + "33",
        border: `1px solid ${s.color}`,
        borderRadius: 20,
        color: s.color,
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px"
      }
    }, s.icon, " ", s.label, " ", cnt) : null;
  }), published > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#22c55e",
      fontSize: 10,
      fontWeight: 700,
      marginLeft: 4
    }
  }, published, "/", data.scenes.length, " published ✓"))), showAddDirection && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a1a2e",
      border: "1px solid #7c3aed55",
      borderRadius: 14,
      padding: 18,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#a78bfa",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 8
    }
  }, "🎯 Direction for the Next 2 Scenes (optional)"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 12,
      marginBottom: 9,
      lineHeight: 1.6
    }
  }, "Tell the writer what you want to happen — a twist, a reveal, a location or mood change, anything. Leave blank to let it continue the story naturally."), /*#__PURE__*/React.createElement("textarea", {
    value: direction,
    onChange: e => setDirection(e.target.value),
    placeholder: "e.g. She finds the letter and realizes he lied the whole time...",
    rows: 3,
    style: {
      width: "100%",
      background: "#070d1a",
      border: "1px solid #7c3aed44",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "9px 12px",
      lineHeight: 1.6,
      resize: "vertical",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 11
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: addTwoScenes,
    disabled: adding,
    style: {
      background: adding ? "#374151" : "linear-gradient(135deg,#7c3aed,#4338ca)",
      border: "none",
      borderRadius: 8,
      color: "#fff",
      fontWeight: 700,
      fontSize: 13,
      padding: "8px 16px",
      cursor: adding ? "not-allowed" : "pointer"
    }
  }, adding ? "⏳ Writing..." : "✨ Generate 2 Scenes"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowAddDirection(false);
      setDirection("");
    },
    disabled: adding,
    style: {
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#9ca3af",
      fontSize: 13,
      padding: "8px 14px",
      cursor: "pointer"
    }
  }, "Cancel")), addMsg && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 9,
      fontSize: 12,
      fontWeight: 700,
      color: addMsg.startsWith("⚠️") ? "#fca5a5" : "#34d399"
    }
  }, addMsg)), editMode && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a1a2e",
      border: "1px solid #3b82f655",
      borderRadius: 14,
      padding: 18,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#60a5fa",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 12
    }
  }, "✏️ Edit Dialogues Only"), data.scenes?.map(s => {
    const pal = ["#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ef4444", "#06b6d4", "#f97316", "#ec4899"];
    const c = pal[(s.scene_number - 1) % pal.length];
    return /*#__PURE__*/React.createElement("div", {
      key: s.scene_number,
      style: {
        marginBottom: 11
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        background: c,
        color: "#000",
        fontWeight: 900,
        borderRadius: 6,
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        flexShrink: 0
      }
    }, s.scene_number), /*#__PURE__*/React.createElement("span", {
      style: {
        color: c,
        fontWeight: 700,
        fontSize: 12
      }
    }, s.scene_title)), /*#__PURE__*/React.createElement("textarea", {
      value: drafts[s.scene_number] || "",
      onChange: e => setDrafts(d => ({
        ...d,
        [s.scene_number]: e.target.value
      })),
      rows: 3,
      style: {
        width: "100%",
        background: "#070d1a",
        border: `1px solid ${c}44`,
        borderRadius: 8,
        color: "#e5e7eb",
        fontSize: 13,
        padding: "9px 12px",
        lineHeight: 1.6,
        resize: "vertical",
        outline: "none",
        boxSizing: "border-box",
        fontFamily: "inherit"
      }
    }));
  })), /*#__PURE__*/React.createElement(FBGen, {
    data: data,
    ai: ai
  }), rawView ? /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#070d1a",
      border: "1px solid #374151",
      borderRadius: 14,
      padding: 18,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#9ca3af",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1
    }
  }, "📄 Raw Markdown"), /*#__PURE__*/React.createElement(CopyBtn, {
    text: fullScript,
    label: "📋 Copy",
    ok: "✓!"
  })), /*#__PURE__*/React.createElement("pre", {
    style: {
      color: "#d1d5db",
      fontSize: 12.5,
      lineHeight: 1.7,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      margin: 0,
      fontFamily: "'Segoe UI',system-ui,monospace"
    }
  }, fullScript)) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#070d1a",
      border: "1px solid #f59e0b44",
      borderRadius: 14,
      padding: 15,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#f59e0b",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1
    }
  }, "🖼️ Universal T2I Filmstrip Prompt"), /*#__PURE__*/React.createElement(CopyBtn, {
    text: data.universal_t2i_prompt
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#d1d5db",
      fontSize: 13,
      lineHeight: 1.7
    }
  }, data.universal_t2i_prompt)), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1.5,
      marginBottom: 14
    }
  }, "Production Scenes"), activeData.scenes?.map(s => /*#__PURE__*/React.createElement(SceneCard, {
    key: s.scene_number,
    scene: s,
    total: activeData.scenes.length,
    tracker: tracker,
    onStageChange: onStageChange,
    onRegen: regenScene,
    elApiKey: elApiKey,
    elVoiceId: elVoiceId
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#064e3b,#065f46)",
      border: "1px solid #10b98155",
      borderRadius: 14,
      padding: 15,
      textAlign: "center",
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#34d399",
      fontWeight: 800,
      fontSize: 13,
      marginBottom: 3
    }
  }, "✅ Ready for Production"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6ee7b7",
      fontSize: 12
    }
  }, "MidJourney → Runway / Kling → ElevenLabs → CapCut / Premiere"))));
};

// ── Character Registry ────────────────────────────────────────────────────────
const CharacterRegistry = ({
  chars,
  onSave
}) => {
  const empty = {
    name: "",
    role: "Protagonist",
    appearance: "",
    voiceTone: "",
    accent: "",
    personality: ""
  };
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const roles = ["Protagonist", "Antagonist", "Supporting", "Narrator", "Recurring"];
  const saveChar = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    const updated = editing !== null ? chars.map((c, i) => i === editing ? {
      ...form,
      id: c.id
    } : c) : [...chars, {
      ...form,
      id: Date.now()
    }];
    await onSave(updated);
    setForm(empty);
    setEditing(null);
    setSaving(false);
  };
  const del = async id => onSave(chars.filter(c => c.id !== id));
  const edit = i => {
    setForm(chars[i]);
    setEditing(i);
  };
  const F = ({
    k,
    label,
    ph,
    rows = 1
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 11
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      color: "#9ca3af",
      fontSize: 10,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      display: "block",
      marginBottom: 4
    }
  }, label), rows > 1 ? /*#__PURE__*/React.createElement("textarea", {
    value: form[k],
    onChange: e => setForm(f => ({
      ...f,
      [k]: e.target.value
    })),
    placeholder: ph,
    rows: rows,
    style: {
      width: "100%",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "8px 11px",
      resize: "vertical",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit",
      lineHeight: 1.6
    }
  }) : /*#__PURE__*/React.createElement("input", {
    value: form[k],
    onChange: e => setForm(f => ({
      ...f,
      [k]: e.target.value
    })),
    placeholder: ph,
    style: {
      width: "100%",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "8px 11px",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#9ca3af",
      fontSize: 12,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 16
    }
  }, chars.length, " Character", chars.length !== 1 ? "s" : "", " — auto-injected into every story you generate"), chars.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      marginBottom: 22
    }
  }, chars.map((c, i) => {
    const rc = {
      Protagonist: "#10b981",
      Antagonist: "#ef4444",
      Supporting: "#3b82f6",
      Narrator: "#f59e0b",
      Recurring: "#a855f7"
    }[c.role] || "#6b7280";
    return /*#__PURE__*/React.createElement("div", {
      key: c.id,
      style: {
        background: "#0f172a",
        border: `1px solid ${rc}44`,
        borderRadius: 12,
        padding: "13px 15px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        background: rc,
        color: "#000",
        fontSize: 10,
        fontWeight: 800,
        borderRadius: 20,
        padding: "2px 8px"
      }
    }, c.role), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#fff",
        fontWeight: 800,
        fontSize: 15
      }
    }, c.name)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => edit(i),
      style: {
        background: "#1e3a5f",
        border: "1px solid #3b82f6",
        borderRadius: 6,
        color: "#60a5fa",
        fontSize: 11,
        padding: "2px 9px",
        cursor: "pointer"
      }
    }, "Edit"), /*#__PURE__*/React.createElement("button", {
      onClick: () => del(c.id),
      style: {
        background: "transparent",
        border: "1px solid #374151",
        borderRadius: 6,
        color: "#6b7280",
        fontSize: 11,
        padding: "2px 9px",
        cursor: "pointer"
      }
    }, "Delete"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "5px 14px"
      }
    }, [["APPEARANCE", c.appearance], ["VOICE", c.voiceTone], ["ACCENT", c.accent], ["PERSONALITY", c.personality]].map(([lbl, val]) => val ? /*#__PURE__*/React.createElement("div", {
      key: lbl
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: rc,
        fontSize: 9,
        fontWeight: 700
      }
    }, lbl, ": "), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "#9ca3af",
        fontSize: 11
      }
    }, val.slice(0, 70), val.length > 70 ? "..." : "")) : null)));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#1f2937,#111827)",
      border: "1px solid #374151",
      borderRadius: 14,
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f59e0b",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 14
    }
  }, editing !== null ? "✏️ Edit Character" : "➕ Add Character"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      color: "#9ca3af",
      fontSize: 10,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      display: "block",
      marginBottom: 5
    }
  }, "Role"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap"
    }
  }, roles.map(r => /*#__PURE__*/React.createElement("button", {
    key: r,
    onClick: () => setForm(f => ({
      ...f,
      role: r
    })),
    style: {
      background: form.role === r ? "#1e3a5f" : "#111827",
      border: `1px solid ${form.role === r ? "#3b82f6" : "#374151"}`,
      borderRadius: 20,
      color: form.role === r ? "#60a5fa" : "#6b7280",
      fontSize: 11,
      padding: "4px 11px",
      cursor: "pointer"
    }
  }, r)))), /*#__PURE__*/React.createElement(F, {
    k: "name",
    label: "Character Name",
    ph: "e.g. Dan Karami"
  }), /*#__PURE__*/React.createElement(F, {
    k: "appearance",
    label: "Physical Appearance (T2I)",
    ph: "e.g. Tall elderly West African man, white kufi, warm eyes, dark robe...",
    rows: 2
  }), /*#__PURE__*/React.createElement(F, {
    k: "voiceTone",
    label: "Voice Tone (ElevenLabs-ready)",
    ph: "e.g. Deep, measured baritone — slow and deliberate, weight of wisdom in every word",
    rows: 2
  }), /*#__PURE__*/React.createElement(F, {
    k: "accent",
    label: "Accent / Speech Style",
    ph: "e.g. Northern Nigerian Hausa accent, formal but warm"
  }), /*#__PURE__*/React.createElement(F, {
    k: "personality",
    label: "Personality & Traits",
    ph: "e.g. Wise, patient, quietly fierce — speaks in proverbs under pressure",
    rows: 2
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: saveChar,
    disabled: !form.name.trim() || saving,
    style: {
      background: !form.name.trim() ? "#374151" : "linear-gradient(135deg,#f59e0b,#ef4444)",
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontWeight: 800,
      fontSize: 13,
      padding: "9px 22px",
      cursor: !form.name.trim() ? "not-allowed" : "pointer"
    }
  }, saving ? "Saving..." : editing !== null ? "Update Character" : "Add to Registry"), editing !== null && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setForm(empty);
      setEditing(null);
    },
    style: {
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 10,
      color: "#6b7280",
      fontSize: 13,
      padding: "9px 14px",
      cursor: "pointer"
    }
  }, "Cancel"))));
};

// ── Settings ───────────────────────────────────────────────────────────────────
const Settings = ({
  elApiKey,
  elVoiceId,
  anthropicKey,
  grokKey,
  provider,
  onSave
}) => {
  const [key, setKey] = useState(elApiKey || "");
  const [voice, setVoice] = useState(elVoiceId || "");
  const [aKey, setAKey] = useState(anthropicKey || "");
  const [gKey, setGKey] = useState(grokKey || "");
  const [prov, setProv] = useState(provider || "anthropic");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [customVoices, setCustomVoices] = useState([]);
  const [newName, setNewName] = useState("");
  const [newId, setNewId] = useState("");
  const DEFAULT_VOICES = [{
    voice_id: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    category: "ElevenLabs Default"
  }, {
    voice_id: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    category: "ElevenLabs Default"
  }, {
    voice_id: "ErXwobaYiN019PkySvjV",
    name: "Antoni",
    category: "ElevenLabs Default"
  }, {
    voice_id: "VR6AewLTigWG4xSOukaG",
    name: "Arnold",
    category: "ElevenLabs Default"
  }, {
    voice_id: "EXAVITQu4vr4xnSDxMaL",
    name: "Bella",
    category: "ElevenLabs Default"
  }, {
    voice_id: "MF3mGyEYCl7XYWbV9V6O",
    name: "Elli",
    category: "ElevenLabs Default"
  }];
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("el_settings");
        if (r?.value) {
          const s = JSON.parse(r.value);
          if (s.key) {
            setKey(s.key);
            setLoaded(true);
          }
          if (s.voiceId) setVoice(s.voiceId);
          if (s.customVoices) setCustomVoices(s.customVoices);
          if (s.anthropicKey) setAKey(s.anthropicKey);
          if (s.grokKey) setGKey(s.grokKey);
          if (s.provider) setProv(s.provider);
        }
      } catch {}
    })();
  }, []);
  const allVoices = [...customVoices, ...DEFAULT_VOICES];
  const selectedVoice = allVoices.find(v => v.voice_id === voice);
  const addCustomVoice = async () => {
    if (!newName.trim() || !newId.trim()) return;
    const updated = [{
      voice_id: newId.trim(),
      name: newName.trim(),
      category: "Your Voice"
    }, ...customVoices];
    setCustomVoices(updated);
    setVoice(newId.trim());
    setNewName("");
    setNewId("");
    await window.storage.set("el_settings", JSON.stringify({
      key,
      voiceId: newId.trim(),
      customVoices: updated,
      anthropicKey: aKey,
      grokKey: gKey,
      provider: prov
    }));
  };
  const removeCustomVoice = async id => {
    const updated = customVoices.filter(v => v.voice_id !== id);
    setCustomVoices(updated);
    if (voice === id) setVoice(updated[0]?.voice_id || DEFAULT_VOICES[0].voice_id);
    await window.storage.set("el_settings", JSON.stringify({
      key,
      voiceId: voice,
      customVoices: updated,
      anthropicKey: aKey,
      grokKey: gKey,
      provider: prov
    }));
  };
  const save = async () => {
    await window.storage.set("el_settings", JSON.stringify({
      key: key.trim(),
      voiceId: voice,
      customVoices,
      anthropicKey: aKey.trim(),
      grokKey: gKey.trim(),
      provider: prov
    }));
    onSave(key.trim(), voice, aKey.trim(), gKey.trim(), prov);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#1f2937,#111827)",
      border: "1px solid #374151",
      borderRadius: 14,
      padding: 22,
      maxWidth: 560
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f59e0b",
      fontWeight: 800,
      fontSize: 13,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 18
    }
  }, "⚙️ Settings"), loaded && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#064e3b",
      border: "1px solid #10b98155",
      borderRadius: 8,
      padding: "7px 12px",
      marginBottom: 14,
      color: "#34d399",
      fontSize: 12,
      fontWeight: 700
    }
  }, "✅ Settings loaded from this browser"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      color: "#9ca3af",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      display: "block",
      marginBottom: 6
    }
  }, "AI Provider (used to generate scripts, regens, and Facebook posts)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setProv("anthropic"),
    style: {
      flex: 1,
      background: prov === "anthropic" ? "#1e3a5f" : "#111827",
      border: `1px solid ${prov === "anthropic" ? "#3b82f6" : "#374151"}`,
      borderRadius: 8,
      color: prov === "anthropic" ? "#60a5fa" : "#9ca3af",
      fontSize: 13,
      fontWeight: 700,
      padding: "8px 0",
      cursor: "pointer"
    }
  }, "🔶 Anthropic Claude"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setProv("grok"),
    style: {
      flex: 1,
      background: prov === "grok" ? "#1e3a5f" : "#111827",
      border: `1px solid ${prov === "grok" ? "#3b82f6" : "#374151"}`,
      borderRadius: 8,
      color: prov === "grok" ? "#60a5fa" : "#9ca3af",
      fontSize: 13,
      fontWeight: 700,
      padding: "8px 0",
      cursor: "pointer"
    }
  }, "✖️ Grok (xAI)"))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a1020",
      border: `1px solid ${prov === "anthropic" ? "#f59e0b44" : "#37415144"}`,
      borderRadius: 12,
      padding: 16,
      marginBottom: 18,
      opacity: prov === "anthropic" ? 1 : 0.6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fbbf24",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 4
    }
  }, "🔑 Anthropic API Key ", prov === "anthropic" && "(active provider)"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 11,
      marginBottom: 10,
      lineHeight: 1.6
    }
  }, "Needed to write scripts, regenerate scenes, and generate Facebook posts. Stored only in this browser, never sent anywhere except Anthropic. Get one at ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "#9ca3af"
    }
  }, "console.anthropic.com/settings/keys"), "."), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: aKey,
    onChange: e => setAKey(e.target.value),
    placeholder: "sk-ant-...",
    style: {
      width: "100%",
      background: "#0f172a",
      border: `1px solid ${aKey ? "#f59e0b66" : "#374151"}`,
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "9px 12px",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a1020",
      border: `1px solid ${prov === "grok" ? "#a855f744" : "#37415144"}`,
      borderRadius: 12,
      padding: 16,
      marginBottom: 18,
      opacity: prov === "grok" ? 1 : 0.6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#c4b5fd",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 4
    }
  }, "✖️ Grok (xAI) API Key ", prov === "grok" && "(active provider)"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 11,
      marginBottom: 10,
      lineHeight: 1.6
    }
  }, "Alternative to Anthropic — same features, different model. Stored only in this browser, never sent anywhere except xAI. Get one at ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "#9ca3af"
    }
  }, "console.x.ai"), "."), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: gKey,
    onChange: e => setGKey(e.target.value),
    placeholder: "xai-...",
    style: {
      width: "100%",
      background: "#0f172a",
      border: `1px solid ${gKey ? "#a855f766" : "#374151"}`,
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "9px 12px",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      color: "#9ca3af",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      display: "block",
      marginBottom: 6
    }
  }, "ElevenLabs API Key"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: key,
    onChange: e => setKey(e.target.value),
    placeholder: "Paste your ElevenLabs API key...",
    style: {
      width: "100%",
      background: "#0f172a",
      border: `1px solid ${key ? "#10b98166" : "#374151"}`,
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "9px 12px",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#4b5563",
      fontSize: 11,
      marginTop: 4
    }
  }, "elevenlabs.io → Profile → API Key")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0a1020",
      border: "1px solid #7c3aed44",
      borderRadius: 12,
      padding: 16,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#a78bfa",
      fontWeight: 800,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 4
    }
  }, "🎙️ Add Your ElevenLabs Voices"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 11,
      marginBottom: 12,
      lineHeight: 1.6
    }
  }, "In ElevenLabs → ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "#9ca3af"
    }
  }, "Voices"), " → click your voice → copy the ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: "#9ca3af"
    }
  }, "Voice ID"), " from the bottom of the panel."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: newName,
    onChange: e => setNewName(e.target.value),
    placeholder: "Voice name (e.g. My Narrator)",
    style: {
      flex: "1 1 140px",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 12,
      padding: "7px 10px",
      outline: "none",
      fontFamily: "inherit"
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: newId,
    onChange: e => setNewId(e.target.value),
    placeholder: "Voice ID (paste here)",
    style: {
      flex: "2 1 200px",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 12,
      padding: "7px 10px",
      outline: "none",
      fontFamily: "inherit"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: addCustomVoice,
    disabled: !newName.trim() || !newId.trim(),
    style: {
      background: "linear-gradient(135deg,#7c3aed,#4338ca)",
      border: "none",
      borderRadius: 8,
      color: "#fff",
      fontSize: 12,
      fontWeight: 700,
      padding: "7px 16px",
      cursor: !newName.trim() || !newId.trim() ? "not-allowed" : "pointer",
      whiteSpace: "nowrap"
    }
  }, "➕ Add")), customVoices.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, customVoices.map(v => /*#__PURE__*/React.createElement("div", {
    key: v.voice_id,
    style: {
      background: "#111827",
      border: `1px solid ${voice === v.voice_id ? "#7c3aed" : "#1f2937"}`,
      borderRadius: 8,
      padding: "7px 11px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      cursor: "pointer"
    },
    onClick: () => setVoice(v.voice_id)
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: voice === v.voice_id ? "#a78bfa" : "#e5e7eb",
      fontWeight: 700,
      fontSize: 13
    }
  }, v.name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#4b5563",
      fontSize: 10,
      marginLeft: 8,
      fontFamily: "monospace"
    }
  }, v.voice_id.slice(0, 16), "…")), /*#__PURE__*/React.createElement("button", {
    onClick: () => removeCustomVoice(v.voice_id),
    style: {
      background: "transparent",
      border: "none",
      color: "#6b7280",
      fontSize: 12,
      cursor: "pointer",
      padding: "0 4px"
    }
  }, "✕"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      color: "#9ca3af",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      display: "block",
      marginBottom: 6
    }
  }, "Active Voice ", selectedVoice && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#6b7280",
      fontWeight: 400,
      textTransform: "none"
    }
  }, "— ", selectedVoice.name)), /*#__PURE__*/React.createElement("select", {
    value: voice,
    onChange: e => setVoice(e.target.value),
    style: {
      width: "100%",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "9px 12px",
      outline: "none",
      boxSizing: "border-box"
    }
  }, customVoices.length > 0 && /*#__PURE__*/React.createElement("optgroup", {
    label: "🎙️ Your Voices"
  }, customVoices.map(v => /*#__PURE__*/React.createElement("option", {
    key: v.voice_id,
    value: v.voice_id
  }, v.name))), /*#__PURE__*/React.createElement("optgroup", {
    label: "📦 ElevenLabs Defaults"
  }, DEFAULT_VOICES.map(v => /*#__PURE__*/React.createElement("option", {
    key: v.voice_id,
    value: v.voice_id
  }, v.name))))), /*#__PURE__*/React.createElement("button", {
    onClick: save,
    style: {
      background: "linear-gradient(135deg,#7c3aed,#4338ca)",
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontWeight: 700,
      fontSize: 13,
      padding: "9px 22px",
      cursor: "pointer"
    }
  }, saved ? "✅ Saved!" : "Save Settings"));
};

// ── Library Card ──────────────────────────────────────────────────────────────
const LibraryCard = ({
  entry,
  active,
  onSelect,
  onDelete
}) => {
  const c = genreColor(entry.genre);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: `1px solid ${active ? c : "#1f2937"}`,
      borderRadius: 12,
      overflow: "hidden",
      background: active ? `${c}11` : "#0f172a",
      transition: "all .15s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: onSelect,
    style: {
      padding: "13px 15px",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      flexWrap: "wrap",
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: c,
      color: "#000",
      fontSize: 10,
      fontWeight: 800,
      borderRadius: 20,
      padding: "2px 8px",
      whiteSpace: "nowrap"
    }
  }, entry.genre), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#6b7280",
      fontSize: 11
    }
  }, entry.scenes, " scenes"), active && /*#__PURE__*/React.createElement("span", {
    style: {
      color: c,
      fontSize: 11,
      fontWeight: 700
    }
  }, "● Viewing")), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fff",
      fontWeight: 700,
      fontSize: 15,
      marginBottom: 4
    }
  }, entry.title), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#9ca3af",
      fontSize: 12,
      lineHeight: 1.5,
      marginBottom: 4
    }
  }, entry.synopsis), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#4b5563",
      fontSize: 11,
      fontStyle: "italic"
    }
  }, "💡 \"", entry.idea, "\"")), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid #1f2937",
      padding: "7px 15px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#4b5563",
      fontSize: 11
    }
  }, new Date(entry.savedAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      onDelete();
    },
    style: {
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 6,
      color: "#6b7280",
      fontSize: 11,
      padding: "2px 9px",
      cursor: "pointer"
    }
  }, "🗑 Delete")));
};

// ── Account Modal ─────────────────────────────────────────────────────────────
const AccountModal = ({
  open,
  onClose,
  user,
  tier,
  onAuthed,
  onSignedOut
}) => {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {ok, text}

  if (!open) return null;
  const submit = async () => {
    if (!email.trim() || pass.length < 8) {
      setMsg({
        ok: false,
        text: "Enter an email and a password of at least 8 characters."
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await api(mode === "signup" ? "signup" : "login", {
      email: email.trim(),
      password: pass
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({
        ok: false,
        text: r.data?.error || "Something went wrong."
      });
      return;
    }
    setMsg({
      ok: true,
      text: mode === "signup" ? "Account created." : "Signed in."
    });
    setPass("");
    await onAuthed();
  };
  const sendMagicLink = async () => {
    if (!email.trim()) {
      setMsg({
        ok: false,
        text: "Enter your email first."
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await api("magic", {
      email: email.trim()
    });
    setBusy(false);
    setMsg(r.ok ? {
      ok: true,
      text: "Check your inbox — we sent a sign-in link to " + email.trim() + "."
    } : {
      ok: false,
      text: r.data?.error || "Could not send sign-in link."
    });
  };
  const sendForgotPassword = async () => {
    if (!email.trim()) {
      setMsg({
        ok: false,
        text: "Enter your email first."
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await api("forgot-password", {
      email: email.trim()
    });
    setBusy(false);
    setMsg(r.ok ? {
      ok: true,
      text: "If that email has an account, a password reset link is on its way."
    } : {
      ok: false,
      text: r.data?.error || "Something went wrong."
    });
  };
  const signOut = async () => {
    setBusy(true);
    await api("logout");
    setBusy(false);
    await onSignedOut();
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      inset: 0,
      background: "#000000aa",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
      padding: 16
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: "#111827",
      border: "1px solid #374151",
      borderRadius: 16,
      padding: 22,
      width: "100%",
      maxWidth: 420,
      maxHeight: "90vh",
      overflowY: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#f9fafb",
      fontWeight: 900,
      fontSize: 16
    }
  }, "Account"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#9ca3af",
      fontSize: 12,
      padding: "4px 10px",
      cursor: "pointer"
    }
  }, "✕ Close")), user ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 10,
      padding: "12px 14px",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#e5e7eb",
      fontSize: 13,
      fontWeight: 700
    }
  }, user.email), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      color: tier === "pro" ? "#34d399" : "#9ca3af",
      fontSize: 12,
      fontWeight: 700
    }
  }, tier === "pro" ? "✅ Pro — thanks for subscribing" : "Free tier")), tier !== "pro" && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#78350f,#92400e)",
      border: "1px solid #f59e0b55",
      borderRadius: 12,
      padding: 16,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fcd34d",
      fontWeight: 800,
      fontSize: 13,
      marginBottom: 6
    }
  }, "Upgrade to Pro — $3.99/mo"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#fde68a",
      fontSize: 12,
      marginBottom: 10,
      lineHeight: 1.6
    }
  }, "One TAHA Studio Labs account, every product. Removes the About section below and unlocks Pro across ScriptForge too."), /*#__PURE__*/React.createElement("a", {
    href: SE_PRO_MONTHLY_CHECKOUT_URL,
    target: "_blank",
    rel: "noopener noreferrer"
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      background: "linear-gradient(135deg,#f59e0b,#ef4444)",
      border: "none",
      borderRadius: 8,
      color: "#fff",
      fontWeight: 800,
      fontSize: 13,
      padding: "9px 18px",
      cursor: "pointer",
      width: "100%"
    }
  }, "⚡ Upgrade — $3.99/month"))), /*#__PURE__*/React.createElement("button", {
    onClick: signOut,
    disabled: busy,
    style: {
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#9ca3af",
      fontSize: 12,
      padding: "7px 14px",
      cursor: "pointer",
      width: "100%"
    }
  }, busy ? "Signing out..." : "Sign out")) : /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      color: "#9ca3af",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      display: "block",
      marginBottom: 5
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    type: "email",
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "you@example.com",
    autoComplete: "email",
    style: {
      width: "100%",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "9px 12px",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit",
      marginBottom: 12
    }
  }), /*#__PURE__*/React.createElement("label", {
    style: {
      color: "#9ca3af",
      fontSize: 11,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      display: "block",
      marginBottom: 5
    }
  }, "Password"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: pass,
    onChange: e => setPass(e.target.value),
    placeholder: "••••••••",
    autoComplete: "current-password",
    style: {
      width: "100%",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "9px 12px",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit",
      marginBottom: 14
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setMode("signin");
      submit();
    },
    disabled: busy,
    style: {
      flex: 1,
      background: "linear-gradient(135deg,#7c3aed,#4338ca)",
      border: "none",
      borderRadius: 8,
      color: "#fff",
      fontWeight: 700,
      fontSize: 13,
      padding: "9px 0",
      cursor: "pointer"
    }
  }, busy && mode === "signin" ? "Signing in..." : "Sign in"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setMode("signup");
      submit();
    },
    disabled: busy,
    style: {
      flex: 1,
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#9ca3af",
      fontWeight: 700,
      fontSize: 13,
      padding: "9px 0",
      cursor: "pointer"
    }
  }, busy && mode === "signup" ? "Creating..." : "Create account")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: sendMagicLink,
    disabled: busy,
    style: {
      flex: 1,
      background: "transparent",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#9ca3af",
      fontSize: 12,
      padding: "7px 0",
      cursor: "pointer"
    }
  }, "✉ Email me a sign-in link instead"), /*#__PURE__*/React.createElement("button", {
    onClick: sendForgotPassword,
    disabled: busy,
    style: {
      background: "transparent",
      border: "none",
      color: "#60a5fa",
      fontSize: 12,
      padding: "7px 10px",
      cursor: "pointer",
      whiteSpace: "nowrap"
    }
  }, "Forgot password?")), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#4b5563",
      fontSize: 11,
      lineHeight: 1.6
    }
  }, "By creating an account you agree to the Terms of Service and Privacy Policy. We store only your email, login credential, and subscription status — your stories and API key never leave this browser.")), msg && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      padding: "8px 12px",
      background: msg.ok ? "#064e3b" : "#7f1d1d",
      border: `1px solid ${msg.ok ? "#10b98155" : "#ef444455"}`,
      borderRadius: 8,
      color: msg.ok ? "#34d399" : "#fca5a5",
      fontSize: 12
    }
  }, msg.text)));
};

// ── About Section ─────────────────────────────────────────────────────────────
const AboutSection = () => /*#__PURE__*/React.createElement("div", {
  style: {
    background: "linear-gradient(135deg,#1f2937,#111827)",
    border: "1px solid #374151",
    borderRadius: 16,
    padding: 24,
    marginTop: 26
  }
}, /*#__PURE__*/React.createElement("h2", {
  style: {
    margin: "0 0 14px",
    fontSize: 17,
    fontWeight: 900,
    color: "#f9fafb"
  }
}, "About TAHA STUDIO ScriptEngine"), /*#__PURE__*/React.createElement("div", {
  style: {
    color: "#d1d5db",
    fontSize: 13,
    lineHeight: 1.75,
    display: "flex",
    flexDirection: "column",
    gap: 12
  }
}, /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0
  }
}, "TAHA STUDIO ScriptEngine builds a single story idea, or a full production booklet for a sequel, into a complete, scene-by-scene cinematic script. For each scene it generates the scene description, natural dialogue capped at 18 spoken words (timed to a 9-second beat), an SFX/sound design brief, a camera motion (I2V) prompt, a kinetic/gesture prompt, and a continuity bridge into the next scene, plus one universal text-to-image prompt to keep the visual style consistent across the whole story."), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0
  }
}, "A character registry lets you define recurring people (appearance, voice tone, accent, personality) that get woven into every script automatically."), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0
  }
}, "Beyond writing, it tracks each scene's production status (scripted → image → video → VO → edited → published), can generate a ready-to-post Facebook caption with hook, CTA, and hashtags, and keeps every story in a permanent library you can revisit, edit, or extend with new scenes."), /*#__PURE__*/React.createElement("p", {
  style: {
    margin: 0
  }
}, "It runs entirely in the browser: you bring your own Anthropic API key. Everything is stored locally on your device.")));

// ── Main App ───────────────────────────────────────────────────────────────────
function App() {
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [showCtx, setShowCtx] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProg] = useState("");
  const [library, setLibrary] = useState([]);
  const [storyCache, setStoryCache] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState("write");
  const [ready, setReady] = useState(false);
  const [characters, setCharacters] = useState([]);
  const [elApiKey, setElApiKey] = useState("");
  const [elVoiceId, setElVoiceId] = useState("21m00Tcm4TlvDq8ikWAM");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [grokKey, setGrokKey] = useState("");
  const [provider, setProvider] = useState("anthropic");
  const [trackers, setTrackers] = useState({});
  const [user, setUser] = useState(null);
  const [tier, setTier] = useState("free");
  const [showAccount, setShowAccount] = useState(false);
  const resultRef = useRef(null);
  const refreshMe = async () => {
    const r = await api("me");
    if (r.ok && r.data) {
      setUser({
        email: r.data.email
      });
      setTier(r.data.tier || "free");
    } else {
      setUser(null);
      setTier("free");
    }
  };
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("library_index");
        if (r?.value) setLibrary(JSON.parse(r.value));
      } catch {}
      try {
        const r = await window.storage.get("char_registry");
        if (r?.value) setCharacters(JSON.parse(r.value));
      } catch {}
      try {
        const r = await window.storage.get("el_settings");
        if (r?.value) {
          const s = JSON.parse(r.value);
          setElApiKey(s.key || "");
          setElVoiceId(s.voiceId || "21m00Tcm4TlvDq8ikWAM");
          setAnthropicKey(s.anthropicKey || "");
          setGrokKey(s.grokKey || "");
          setProvider(s.provider || "anthropic");
        }
      } catch {}
      await refreshMe();
      setReady(true);
    })();
  }, []);
  const saveChars = async u => {
    await window.storage.set("char_registry", JSON.stringify(u));
    setCharacters(u);
  };
  const saveElSettings = async (k, v, ak, gk, prov) => {
    setElApiKey(k);
    setElVoiceId(v);
    setAnthropicKey(ak);
    setGrokKey(gk);
    setProvider(prov);
  };
  const aiConfig = {
    provider,
    anthropicKey,
    grokKey
  };
  const getTracker = async id => {
    if (trackers[id]) return trackers[id];
    try {
      const r = await window.storage.get(`tracker:${id}`);
      if (r?.value) {
        const t = JSON.parse(r.value);
        setTrackers(p => ({
          ...p,
          [id]: t
        }));
        return t;
      }
    } catch {}
    const e = {};
    setTrackers(p => ({
      ...p,
      [id]: e
    }));
    return e;
  };
  const updateStage = async (sid, snum, idx) => {
    const t = {
      ...(trackers[sid] || {}),
      [snum]: idx
    };
    await window.storage.set(`tracker:${sid}`, JSON.stringify(t));
    setTrackers(p => ({
      ...p,
      [sid]: t
    }));
  };
  const saveToStorage = async (entry, fullData) => {
    const nl = [entry, ...library];
    await window.storage.set("library_index", JSON.stringify(nl));
    await window.storage.set(`story:${entry.id}`, JSON.stringify(fullData));
    setLibrary(nl);
    setStoryCache(c => ({
      ...c,
      [entry.id]: fullData
    }));
  };
  const loadStory = async id => {
    if (storyCache[id]) return storyCache[id];
    try {
      const r = await window.storage.get(`story:${id}`);
      if (r?.value) {
        const d = JSON.parse(r.value);
        setStoryCache(c => ({
          ...c,
          [id]: d
        }));
        return d;
      }
    } catch {}
    return null;
  };
  const deleteStory = async id => {
    const u = library.filter(e => e.id !== id);
    await window.storage.set("library_index", JSON.stringify(u));
    try {
      await window.storage.delete(`story:${id}`);
    } catch {}
    try {
      await window.storage.delete(`tracker:${id}`);
    } catch {}
    setLibrary(u);
    setStoryCache(c => {
      const n = {
        ...c
      };
      delete n[id];
      return n;
    });
    if (activeId === id) setActiveId(u[0]?.id || null);
  };
  const selectStory = async id => {
    setActiveId(id);
    await loadStory(id);
    await getTracker(id);
    setView("write");
    setTimeout(() => resultRef.current?.scrollIntoView({
      behavior: "smooth"
    }), 100);
  };
  const rescan = async () => {
    setProg("🔍 Scanning...");
    setLoading(true);
    try {
      const keys = (await window.storage.list("story:"))?.keys || [];
      const entries = [];
      for (const key of keys) {
        try {
          const r = await window.storage.get(key);
          if (r?.value) {
            const d = JSON.parse(r.value);
            const id = parseInt(key.replace("story:", ""));
            entries.push({
              id,
              title: d.title || "Untitled",
              genre: d.genre || "Drama",
              synopsis: d.synopsis || "",
              idea: d.idea || "",
              scenes: d.scenes?.length || 0,
              savedAt: id
            });
            setStoryCache(c => ({
              ...c,
              [id]: d
            }));
          }
        } catch {}
      }
      entries.sort((a, b) => b.savedAt - a.savedAt);
      await window.storage.set("library_index", JSON.stringify(entries));
      setLibrary(entries);
      setView("library");
    } catch (e) {
      setError("Rescan failed: " + e.message);
    }
    setLoading(false);
    setProg("");
  };
  const generate = async () => {
    if (!idea.trim()) return;
    const activeKey = provider === "grok" ? grokKey : anthropicKey;
    if (!activeKey.trim()) {
      setError(`Add your ${provider === "grok" ? "Grok (xAI)" : "Anthropic"} API key in Settings (⚙️) first.`);
      return;
    }
    setLoading(true);
    setError("");
    setProg("✍️ Crafting your story...");
    try {
      const raw = await callAI(aiConfig, buildSystemPrompt(context.trim(), characters), `Story idea / production brief:\n\n${idea}`, 8000);
      setProg("🎬 Building scenes...");
      let clean = raw.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch {
        const cut = Math.max(clean.lastIndexOf('},\n    {') + 1, clean.lastIndexOf('}') + 1);
        let rep = clean.slice(0, cut);
        rep += ']'.repeat(Math.max(0, (rep.match(/\[/g) || []).length - (rep.match(/\]/g) || []).length));
        rep += '}'.repeat(Math.max(0, (rep.match(/{/g) || []).length - (rep.match(/}/g) || []).length));
        parsed = JSON.parse(rep);
      }
      const id = Date.now();
      const entry = {
        id,
        title: parsed.title,
        genre: parsed.genre,
        synopsis: parsed.synopsis,
        idea: idea.slice(0, 120),
        scenes: parsed.scenes?.length || 0,
        savedAt: id
      };
      setProg("💾 Saving...");
      await saveToStorage(entry, parsed);
      setActiveId(id);
      setIdea("");
      setView("write");
      setTimeout(() => resultRef.current?.scrollIntoView({
        behavior: "smooth"
      }), 150);
    } catch (e) {
      setError("Something went wrong. " + e.message);
    }
    setLoading(false);
    setProg("");
  };
  const activeStory = storyCache[activeId];
  const activeTracker = trackers[activeId] || {};
  const TABS = [{
    id: "write",
    label: "✍️ Write"
  }, {
    id: "library",
    label: `📚 Library${library.length ? ` (${library.length})` : ""}`
  }, {
    id: "characters",
    label: `👥 Characters${characters.length ? ` (${characters.length})` : ""}`
  }, {
    id: "settings",
    label: "⚙️ Settings"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: "#030712",
      fontFamily: "'Segoe UI',system-ui,sans-serif",
      color: "#f9fafb"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)",
      padding: "16px 20px",
      borderBottom: "1px solid #1f2937"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 920,
      margin: "0 auto",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 19,
      fontWeight: 900,
      background: "linear-gradient(90deg,#f59e0b,#ec4899,#3b82f6)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent"
    }
  }, "🎬 TAHA STUDIO ScriptEngine"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: "#6b7280",
      margin: "2px 0 0",
      fontSize: 11
    }
  }, "Type the idea. Get the whole production.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      flexWrap: "wrap",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: rescan,
    disabled: loading,
    title: "Rescan & rebuild library",
    style: {
      background: "#1f2937",
      border: "1px solid #374151",
      borderRadius: 8,
      color: "#9ca3af",
      padding: "6px 11px",
      cursor: "pointer",
      fontSize: 13
    }
  }, "🔄"), TABS.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => setView(t.id),
    style: {
      background: view === t.id ? "#1e3a5f" : "#1f2937",
      border: `1px solid ${view === t.id ? "#3b82f6" : "#374151"}`,
      borderRadius: 8,
      color: view === t.id ? "#60a5fa" : "#9ca3af",
      padding: "6px 13px",
      cursor: "pointer",
      fontSize: 11,
      fontWeight: 700
    }
  }, t.label)), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowAccount(true),
    style: {
      background: tier === "pro" ? "#064e3b" : "#1f2937",
      border: `1px solid ${tier === "pro" ? "#10b981" : "#374151"}`,
      borderRadius: 8,
      color: tier === "pro" ? "#34d399" : "#9ca3af",
      padding: "6px 13px",
      cursor: "pointer",
      fontSize: 11,
      fontWeight: 700
    }
  }, user ? tier === "pro" ? "✅ Pro" : "👤 Account" : "Sign In")))), /*#__PURE__*/React.createElement(AccountModal, {
    open: showAccount,
    onClose: () => setShowAccount(false),
    user: user,
    tier: tier,
    onAuthed: async () => {
      await refreshMe();
      setShowAccount(false);
    },
    onSignedOut: async () => {
      setUser(null);
      setTier("free");
      setShowAccount(false);
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 920,
      margin: "0 auto",
      padding: "20px 18px"
    }
  }, view === "library" && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#9ca3af",
      fontSize: 12,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: 14
    }
  }, library.length ? `${library.length} Stor${library.length === 1 ? "y" : "ies"}` : "No stories yet"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, library.map(e => /*#__PURE__*/React.createElement(LibraryCard, {
    key: e.id,
    entry: e,
    active: activeId === e.id,
    onSelect: () => selectStory(e.id),
    onDelete: () => deleteStory(e.id)
  })))), view === "characters" && /*#__PURE__*/React.createElement(CharacterRegistry, {
    chars: characters,
    onSave: saveChars
  }), view === "settings" && /*#__PURE__*/React.createElement(Settings, {
    elApiKey: elApiKey,
    elVoiceId: elVoiceId,
    anthropicKey: anthropicKey,
    grokKey: grokKey,
    provider: provider,
    onSave: saveElSettings
  }), view === "write" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "linear-gradient(135deg,#1f2937,#111827)",
      border: "1px solid #374151",
      borderRadius: 16,
      padding: 20,
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: "block",
      fontWeight: 700,
      fontSize: 14,
      color: "#f59e0b",
      marginBottom: 9,
      letterSpacing: 0.5
    }
  }, "💡 YOUR STORY IDEA / PRODUCTION BRIEF"), /*#__PURE__*/React.createElement("textarea", {
    value: idea,
    onChange: e => setIdea(e.target.value),
    placeholder: "Describe your story idea, or paste a full production booklet for a sequel/continuation...",
    rows: 4,
    style: {
      width: "100%",
      background: "#0f172a",
      border: "1px solid #374151",
      borderRadius: 10,
      color: "#e5e7eb",
      fontSize: 14,
      padding: "13px 15px",
      lineHeight: 1.7,
      resize: "vertical",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  }), characters.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 9,
      padding: "7px 11px",
      background: "#0f172a",
      border: "1px solid #10b98144",
      borderRadius: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#34d399",
      fontSize: 11,
      fontWeight: 700
    }
  }, "👥 Characters auto-injected: "), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#6b7280",
      fontSize: 11
    }
  }, characters.map(c => c.name).join(", "))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 11
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowCtx(s => !s),
    style: {
      background: "transparent",
      border: `1px solid ${showCtx ? "#7c3aed" : "#374151"}`,
      borderRadius: 8,
      color: showCtx ? "#a78bfa" : "#6b7280",
      fontSize: 12,
      fontWeight: 700,
      padding: "5px 13px",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", null, showCtx ? "▲" : "▼"), "📌 ", showCtx ? "Hide" : "Add", " Story Context ", context.trim() ? "(loaded ✓)" : "(for sequels)"), showCtx && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 12,
      marginBottom: 6
    }
  }, "Previous season synopsis or world-building to treat as canon."), /*#__PURE__*/React.createElement("textarea", {
    value: context,
    onChange: e => setContext(e.target.value),
    placeholder: "Season 1 synopsis, key events, world rules...",
    rows: 4,
    style: {
      width: "100%",
      background: "#0f172a",
      border: "1px solid #7c3aed55",
      borderRadius: 10,
      color: "#e5e7eb",
      fontSize: 13,
      padding: "11px 13px",
      lineHeight: 1.7,
      resize: "vertical",
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  }))), !(provider === "grok" ? grokKey : anthropicKey).trim() && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 11,
      padding: "8px 12px",
      background: "#3a2a0a",
      border: "1px solid #f59e0b55",
      borderRadius: 8,
      color: "#fcd34d",
      fontSize: 12
    }
  }, "🔑 Add your ", provider === "grok" ? "Grok (xAI)" : "Anthropic", " API key in ", /*#__PURE__*/React.createElement("strong", null, "⚙️ Settings"), " before generating."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 13,
      flexWrap: "wrap",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#4b5563",
      fontSize: 12
    }
  }, ready && library.length > 0 ? `📚 ${library.length} stor${library.length === 1 ? "y" : "ies"} saved` : "Stories saved permanently"), /*#__PURE__*/React.createElement("button", {
    onClick: generate,
    disabled: loading || !idea.trim(),
    style: {
      background: loading ? "#374151" : "linear-gradient(135deg,#f59e0b,#ef4444)",
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontWeight: 800,
      fontSize: 14,
      padding: "11px 26px",
      cursor: loading || !idea.trim() ? "not-allowed" : "pointer",
      transition: "all .2s"
    }
  }, loading ? progress || "Generating..." : "🚀 Generate Script"))), loading && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      padding: "34px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 34,
      marginBottom: 9
    }
  }, "🎭"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#f59e0b",
      fontWeight: 700,
      fontSize: 15
    }
  }, progress), /*#__PURE__*/React.createElement("div", {
    style: {
      color: "#6b7280",
      fontSize: 12,
      marginTop: 4
    }
  }, "Crafting scenes with full production specs...")), error && /*#__PURE__*/React.createElement("div", {
    style: {
      background: "#7f1d1d",
      border: "1px solid #ef4444",
      borderRadius: 10,
      padding: 13,
      color: "#fca5a5",
      marginBottom: 18
    }
  }, "⚠️ ", error), library.length > 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 16,
      flexWrap: "wrap"
    }
  }, library.slice(0, 6).map(e => {
    const c = genreColor(e.genre);
    return /*#__PURE__*/React.createElement("button", {
      key: e.id,
      onClick: () => selectStory(e.id),
      style: {
        background: activeId === e.id ? `${c}22` : "#1f2937",
        border: `1px solid ${activeId === e.id ? c : "#374151"}`,
        borderRadius: 20,
        color: activeId === e.id ? c : "#9ca3af",
        padding: "4px 11px",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 600,
        maxWidth: 155,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, activeId === e.id ? "▶ " : "", e.title);
  }), library.length > 6 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setView("library"),
    style: {
      background: "#1f2937",
      border: "1px solid #374151",
      borderRadius: 20,
      color: "#6b7280",
      padding: "4px 11px",
      cursor: "pointer",
      fontSize: 11
    }
  }, "+", library.length - 6, " more →")), activeStory && /*#__PURE__*/React.createElement("div", {
    ref: resultRef
  }, /*#__PURE__*/React.createElement(StoryView, {
    data: activeStory,
    elApiKey: elApiKey,
    elVoiceId: elVoiceId,
    ai: aiConfig,
    tracker: activeTracker,
    onStageChange: (sn, si) => updateStage(activeId, sn, si),
    onSave: async u => {
      await window.storage.set(`story:${activeId}`, JSON.stringify(u));
      setStoryCache(c => ({
        ...c,
        [activeId]: u
      }));
      setLibrary(l => l.map(e => e.id === activeId ? {
        ...e,
        scenes: u.scenes?.length || e.scenes
      } : e));
    }
  }))), tier !== "pro" && /*#__PURE__*/React.createElement(AboutSection, null)));
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(App, null));