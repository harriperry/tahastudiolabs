
/* ─────────────────────────  THE EXACT FORMATTER PROMPT  ───────────────────────── */
function tstamp(sec){const m=String(Math.floor(sec/60)).padStart(2,"0"),s=String(sec%60).padStart(2,"0");return `${m}:${s}`;}
/* SEGMENT TIMING MODEL: segments 1-3 are 10 seconds each (0-10, 10-20, 20-30). From segment 4
   onward, each segment is 15 seconds (30-45, 45-60, 60-75, ...), continuing until the video
   reaches 5 minutes (300s total, which lands exactly on segment 21). segEndTime/segStartTime/
   segDuration are the single source of truth for this and are used everywhere timing is
   computed or displayed (prompt building, word-count targets, UI badges, Library display, PDF
   export) so the model never drifts out of sync in different places. */
function segEndTime(i){ return i<=3 ? i*10 : 30+(i-3)*15; }
function segStartTime(i){ return i<=1 ? 0 : segEndTime(i-1); }
function segDuration(i){ return segEndTime(i)-segStartTime(i); }
function totalLabel(n){const t=segEndTime(n);return t%60===0?`${t/60}-minute (${t}-second)`:`${t}-second`;}
/* B-ROLL FIELD RESTRUCTURE: the old template had 2 loosely-defined fields ("Visual / B-Roll
   Prompt" + "Motion") that left camera movement, lighting, and mood folded into one blob of
   text, or skipped entirely, and never distinguished a still-frame description from a motion
   instruction. Video generators work better when those roles are separated explicitly, so this
   now asks for 5 distinct fields per segment: a Text-to-Image Prompt (the still composition),
   an Image-to-Video Prompt (what happens as it moves), Camera Movement, Lighting, and Mood.
   renderOutput()/pick() in this file parse all 5 out by their exact labels below, and genClip()
   recombines them into one prompt when generating a clip, so the video generator gets the full
   picture instead of a single vague sentence. */
function buildSystemPrompt(n, ratio, allowBRoll){
if (allowBRoll === undefined) allowBRoll = true;
const timingRule = Array.from({length:n},(_,i)=>{const s=i+1;return `Segment ${s} = ${tstamp(segStartTime(s))}\u2013${tstamp(segEndTime(s))} (${segDuration(s)}s)`;}).join(", ");
return `Act as a professional AI video production formatter. Take the full script the user provides, and split it EXACTLY into ${n} segment${n>1?'s':''} to make a total ${totalLabel(n)} video. Segment duration is NOT uniform: segments 1-3 are 10 seconds each, and every segment from segment 4 onward is 15 seconds each. Use the exact per-segment start/end times listed in rule 1 below, do not deviate from them.

Follow this exact structure for EVERY segment. Keep wording clear and concise, match the tone of the original script, and ensure smooth natural continuity between segments.

---

### SEGMENT [NUMBER] | [START TIME]–[END TIME]

**Type**: [${allowBRoll ? "On-Camera / Voiceover + B-Roll / On-Camera + Brand Close" : "On-Camera / On-Camera + Brand Close"}]

**TTS Script**:
> [Full spoken text for this exact segment duration (10 seconds for segments 1-3, 15 seconds for segment 4 onward, per the timing list in rule 1). WORD-COUNT TARGET (rule 6): roughly 22-28 words for a 10-second segment, roughly 33-42 words for a 15-second segment. This is a target range to fill with real substance, not just a ceiling to duck under, a bare 4-8 word slogan fragment badly wastes the available speaking time and is never acceptable, use close to the full word count with a genuine line, not a caption. Write this like a working screenwriter, not a summary of one: real spoken rhythm, contractions, natural interruption or trailing off where it fits, never a tidy expository paragraph and never a bare fragment either. Weave in sensory-grounded environmental detail economically, a phrase or two, not a paragraph, so the setting feels occupied and specific without blowing the word count. Build mood through word choice, pacing, and what gets noticed or left unsaid, rather than naming the mood outright. If more than one character speaks anywhere in this script, give each one a distinct, identifiable voice in rhythm and vocabulary, never interchangeable lines with a different name attached. Show what the moment looks, sounds, and feels like rather than stating a conclusion about it, and avoid dialogue that exists only to inform the audience of facts the characters would already know. Include short connecting phrases to flow smoothly between segments, keep it perfectly timed for that duration]

**Text-to-Image Prompt**:
> [Detailed, photorealistic ${ratio} still-frame prompt describing the opening composition of this shot: subject, setting, wardrobe or props, framing, and style, specific enough to generate a single reference still image on its own]

**Image-to-Video Prompt**:
> [Only the kinetic action and camera path for this segment's duration, written as motion instructions for a model animating a still image. Do NOT include descriptive adjectives about the characters' appearance, clothing, environment, or target objects/products (no color, material, brand, or style descriptors for things like perfume bottles, cans, phones, computers, wardrobe, or setting) — the model must rely entirely on the uploaded reference image for all visual detail. Describe motion and camera path only]

**Camera Movement**:
> [Exactly ONE single-axis camera motion for this entire segment: either a pure horizontal pan, a pure vertical tilt, or a steady linear dolly-in/out. Never combine two axes of movement in the same segment, and never leave the camera fully static or locked off. Every single segment must have some deliberate camera movement, even if subtle. Vary which axis and direction you use from one segment to the next so consecutive segments never repeat the same camera move. If the moment calls for high kinetic energy, keep the camera itself single-axis and put additional energy into the scenery/background instead (e.g. background motion blur or moving background elements)]

**Lighting**:
> [Lighting setup and quality: source, direction, color temperature, time of day]

**Mood**:
> [Overall emotional tone and atmosphere of the shot, in a few words, matching the mood already built through the TTS Script's word choice and pacing above, not a mood invented separately from it]

**Audio Note**:
> [MANDATORY — never leave this generic, vague, or empty. AUDIBLE DETAIL ONLY: describe sound and only sound, never smell, visual appearance, or touch/texture here, those belong in the Text-to-Image Prompt or TTS Script fields instead. Describe the ambient environmental soundscape that actually belongs in this shot's setting, based on what the Text-to-Image Prompt above describes. No real-world location is ever acoustically silent: an outdoor/forest/nature setting needs wind through leaves, birdsong, distant animal sounds, or rustling underbrush; a city street or urban setting needs traffic hum, distant horns, footsteps, or crowd/pedestrian ambience; a market or crowded space needs overlapping voices and bustle; an indoor room needs quiet room tone and any appliance/HVAC hum; rain, wind, or weather visible in the shot needs its own audible layer. Layer this ambience under any dialogue or music, at a level that supports rather than competes with the TTS Script. Also note music level or voice clarity guidance here if relevant]

---

Additional rules:
1. Keep all timing precise: ${timingRule}
2. Preserve all original key information, brand names, products, and facts exactly as given in the input, and keep them the throughline of the output across every segment. Atmosphere, mood, and scene-setting exist to serve the actual subject of the script, never to replace or crowd it out. If the input names a specific brand or product, that brand or product must be clearly present and named in the output starting from the first segment, not diluted into generic scenery or deferred entirely to a later moment
3. Match the visual style, realism, and location details from the original reference examples
4. Output as clean, copy-paste ready blocks exactly like the sample format
5. If voice ID, avatar, or technical specs are provided, include them at the very top of the output in a "TECHNICAL SPECS" block before Segment 1
6. Pace TTS at approximately 150 spoken words per minute (about 2.5 words per second) for each segment's specific duration: roughly 22-28 words for a 10-second segment (segments 1-3), and roughly 33-42 words for a 15-second segment (segment 4 onward)
7. Visuals: cinematic documentary grade, ultra-realistic African physiognomy where people appear, specify era, geography, lighting, and composition. Never use generic stock-photo descriptors. The Text-to-Image Prompt and Image-to-Video Prompt must each be independently detailed enough that a video generator fully understands the role it should play: one describes the still composition, the other describes the motion
8. Never use an em dash (the "—" character) anywhere in the output, in any field. Use a comma, a period, or the word "and" instead
9. Camera Movement must always be single-axis only for every segment: pure pan, pure tilt, or pure dolly in/out. Never combine axes in one segment, and never use a fully static or locked-off shot, the camera must always be doing something, however subtle. Vary the axis and direction across segments so the camera never repeats the same move twice in a row. Use background motion for kinetic energy instead of a complex camera path
10. The Image-to-Video Prompt must never include descriptive adjectives about character appearance, clothing, environment, or target objects/products — describe only the kinetic action and camera path. All visual detail comes from the reference image, not the prompt
11. B-Roll handling: ${allowBRoll ? "Voiceover + B-Roll segments are allowed and encouraged where they suit the content, use them for cutaway shots that support the narration." : "B-Roll is DISABLED for this script. Every segment's Type must be On-Camera or On-Camera + Brand Close only, never Voiceover + B-Roll. Every Text-to-Image and Image-to-Video prompt must keep the on-camera presenter/subject directly in frame at all times, never a cutaway B-roll-only shot."}
12. Audio Note is never optional and never generic: every single segment's Audio Note must name the specific ambient environmental sound that setting would realistically have (see the Audio Note field description above for examples). A forest is never silent. A city center is never silent. Judge the correct ambience from that segment's own Text-to-Image Prompt setting, not from a single blanket assumption applied to every segment. Audio Note describes sound only, never smell, sight, or texture, those non-audible senses belong in the Text-to-Image Prompt or TTS Script fields instead, not here
13. Before writing any segment, read and fully understand the ENTIRE script provided below, start to finish, including scenes and details near the end. Every segment's content, tone, and continuity must reflect full awareness of the whole script, not just the portion nearest that segment. Do not treat any part of the input as optional to read
14. Environment and atmosphere are mandatory in every segment, not optional. Sensory-grounded setting detail, sound, light, texture, temperature, movement in the space, must come through the TTS Script and scene content. A bare location label is never enough on its own, the reader or listener must be able to feel the space, not just picture a caption for it
15. Mood must be established and sustained, not just named. Build tension, warmth, unease, or any other emotional register through pacing, word choice, and which details get selected, the way a screenwriter blocks a scene to create feeling before a line lands. Do not simply assert what the mood is
16. Dialogue must sound spoken, not written. Real people interrupt, trail off, use contractions, and rarely speak in complete tidy paragraphs. Avoid expository dialogue that only exists to inform the audience of facts the characters would already know (no "as you know..." exposition), let information and emotion come through naturally instead
17. Every speaking character must have a distinct, identifiable voice, rhythm, vocabulary, and tone that differ from every other character, never interchangeable script blocks distinguished only by the name attached to them
18. Show, don't summarize. Render what a moment looks like, sounds like, and feels like rather than stating a conclusion about it. This is the single biggest lever for writing that reads as vivid and specific rather than flat and generic
19. Whenever a segment's Type is On-Camera or On-Camera + Brand Close, the on-screen subject is the one delivering the TTS Script, out loud, directly to camera, this is a spoken-to-camera moment, not narration played over unrelated footage of that person. Write the TTS Script as a line that person would actually say on camera (first person is fine, but it must read as dialogue delivered to the viewer, not a diary-style travelogue caption). The Image-to-Video Prompt's physical action must stay compatible with speaking: a person cannot naturally talk with their mouth full or while mid-drink, so if the moment includes eating, drinking, or anything else that occupies the mouth, stage it as a distinct beat clearly before or after the spoken line, never simultaneous with it
20. Output ONLY the formatted blocks. No preamble, no commentary, no closing remarks.`;
}

/* ─────────────────────────  DOM  ───────────────────────── */
const $ = id => document.getElementById(id);
const els = {
  apiKey: $("apiKey"), rememberKey: $("rememberKey"), model: $("model"),
  formatProvider: $("formatProvider"),
  anthropicFormatOptions: $("anthropicFormatOptions"), geminiFormatOptions: $("geminiFormatOptions"), groqFormatOptions: $("groqFormatOptions"), deepseekFormatOptions: $("deepseekFormatOptions"),
  apiKeyGemini: $("apiKeyGemini"), rememberKeyGemini: $("rememberKeyGemini"), modelGemini: $("modelGemini"),
  apiKeyGroq: $("apiKeyGroq"), rememberKeyGroq: $("rememberKeyGroq"), modelGroq: $("modelGroq"),
  apiKeyDeepseek: $("apiKeyDeepseek"), rememberKeyDeepseek: $("rememberKeyDeepseek"), modelDeepseek: $("modelDeepseek"),
  allowBRoll: $("allowBRoll"),
  segCount: $("segCount"), lenBadge: $("lenBadge"),
  ratio: $("ratio"),
  techSpecs: $("techSpecs"), script: $("script"), wordMeter: $("wordMeter"),
  btnFormat: $("btnFormat"), btnClear: $("btnClear"), btnMock: $("btnMock"), status: $("status"),
  output: $("output"), rawOut: $("rawOut"),
  btnToggleRaw: $("btnToggleRaw"), btnCopyAll: $("btnCopyAll"),
  scriptType: $("scriptType"), btnSaveLib: $("btnSaveLib"), btnPdf: $("btnPdf"),
  btnLibrary: $("btnLibrary"), libOverlay: $("libOverlay"), libList: $("libList"), btnLibClose: $("btnLibClose"),
  videoKeyVeo: $("videoKeyVeo"), rememberVideoKeyVeo: $("rememberVideoKeyVeo"),
  videoKeyGrok: $("videoKeyGrok"), rememberVideoKeyGrok: $("rememberVideoKeyGrok"),
  videoKeyHeygen: $("videoKeyHeygen"), rememberVideoKeyHeygen: $("rememberVideoKeyHeygen"),
heygenAvatarId: $("heygenAvatarId"),
  refImg1: $("refImg1"), refImg1prev: $("refImg1prev"),
  refImg2: $("refImg2"), refImg2prev: $("refImg2prev"),
  refImg3: $("refImg3"), refImg3prev: $("refImg3prev"),
  vidAspectRatio: $("vidAspectRatio"), vidResolution: $("vidResolution"),
  elevenLabsKey: $("elevenLabsKey"), rememberElevenLabsKey: $("rememberElevenLabsKey"),
  btnFetchVoices: $("btnFetchVoices"), elevenLabsVoice: $("elevenLabsVoice"), elevenLabsStatus: $("elevenLabsStatus"),
  recommendCard: $("recommendCard"), recWritingLabel: $("recWritingLabel"), recWritingReason: $("recWritingReason"),
  recVideoTip: $("recVideoTip"), recVoiceTip: $("recVoiceTip"), recCostTime: $("recCostTime"),
  recConfidence: $("recConfidence"), apiConfigAutoNote: $("apiConfigAutoNote"),
  btnRecommendUse: $("btnRecommendUse"), btnRecommendDismiss: $("btnRecommendDismiss"),
  btnCharLib: $("btnCharLib"), charOverlay: $("charOverlay"), btnCharClose: $("btnCharClose"),
  btnCharNew: $("btnCharNew"), charListView: $("charListView"), charList: $("charList"),
  charFormView: $("charFormView"), btnCharBack: $("btnCharBack"), charId: $("charId"),
  charDisplayName: $("charDisplayName"), charType: $("charType"), charAge: $("charAge"),
  charAppearance: $("charAppearance"),
  charHair: $("charHair"), charTone: $("charTone"), charElevenVoiceId: $("charElevenVoiceId"),
  charOutfitDefault: $("charOutfitDefault"), charOutfitExtra: $("charOutfitExtra"),
  btnCharAddOutfit: $("btnCharAddOutfit"), charImgFront: $("charImgFront"), charImgFrontPrev: $("charImgFrontPrev"),
  charImgThreeQuarter: $("charImgThreeQuarter"), charImgThreeQuarterPrev: $("charImgThreeQuarterPrev"),
  charImgProfile: $("charImgProfile"), charImgProfilePrev: $("charImgProfilePrev"),
  charAnchorPreview: $("charAnchorPreview"), btnCharSave: $("btnCharSave"), btnCharDelete: $("btnCharDelete"),
  btnCharImportOpen: $("btnCharImportOpen"), charImportView: $("charImportView"), btnCharImportBack: $("btnCharImportBack"),
  charImportText: $("charImportText"), btnCharImportParse: $("btnCharImportParse"), charImportPreview: $("charImportPreview"),
  charImportSaveRow: $("charImportSaveRow"), btnCharImportSave: $("btnCharImportSave")
};
let lastRaw = "";
let lastMeta = null;
let chainFrames = {};

/* remember key (local file — localStorage, guarded) */
try {
  const saved = localStorage.getItem("sca_fmt_key");
  if (saved) { els.apiKey.value = saved; els.rememberKey.checked = true; }
} catch(e){}
els.rememberKey.addEventListener("change", persistKey);
els.apiKey.addEventListener("input", persistKey);
function persistKey(){
  try {
    if (els.rememberKey.checked) localStorage.setItem("sca_fmt_key", els.apiKey.value);
    else localStorage.removeItem("sca_fmt_key");
  } catch(e){}
}

/* Remember Gemini/Groq keys for script formatting — same one-slot-per-provider pattern used
   for the video providers below. Anthropic keeps its own dedicated apiKey/rememberKey/
   persistKey above (unchanged, still "sca_fmt_key") since it predates this pattern and
   existing saved keys shouldn't be disturbed. */
const FORMAT_PROVIDERS = {
  gemini:   { keyEl: "apiKeyGemini",   rememberEl: "rememberKeyGemini",   ls: "sf_format_key_gemini" },
  groq:     { keyEl: "apiKeyGroq",     rememberEl: "rememberKeyGroq",     ls: "sf_format_key_groq" },
  deepseek: { keyEl: "apiKeyDeepseek", rememberEl: "rememberKeyDeepseek", ls: "sf_format_key_deepseek" }
};
Object.values(FORMAT_PROVIDERS).forEach(p => {
  try {
    const saved = localStorage.getItem(p.ls);
    if (saved) { els[p.keyEl].value = saved; els[p.rememberEl].checked = true; }
  } catch (e) {}
  els[p.keyEl].addEventListener("input", () => persistFormatKey(p));
  els[p.rememberEl].addEventListener("change", () => persistFormatKey(p));
});
function persistFormatKey(p) {
  try {
    if (els[p.rememberEl].checked) localStorage.setItem(p.ls, els[p.keyEl].value);
    else localStorage.removeItem(p.ls);
  } catch (e) {}
}

/* Show only the key/model fields for whichever script-writing provider is selected — same
   show/hide-by-provider pattern used for the video providers' option panels. */
function switchFormatProvider() {
  const p = els.formatProvider.value;
  els.anthropicFormatOptions.style.display = p === "anthropic" ? "" : "none";
  els.geminiFormatOptions.style.display = p === "gemini" ? "" : "none";
  els.groqFormatOptions.style.display = p === "groq" ? "" : "none";
  els.deepseekFormatOptions.style.display = p === "deepseek" ? "" : "none";
}
els.formatProvider.addEventListener("change", switchFormatProvider);
switchFormatProvider();

/* ═══════════════ SMART RECOMMENDATION (lightweight Mode 2) ═══════════════
   Additive-only feature: a plain lookup table + one render function, no new architecture,
   no provider adapters, no live resource/cost polling (most providers don't expose that via a
   BYOK-friendly API anyway). Suggests a writing provider for the selected Script Type, plus
   plain-text guidance for video/voice (there's no single global "video provider" control to
   pre-fill — that choice happens per-segment after formatting — so those two stay informational
   rather than actionable). Every number here is a rough, clearly-labeled estimate, not a real
   balance check.
   ROLLBACK: set FEATURE_SMART_RECOMMEND to false and redeploy to hide this instantly — nothing
   else in the app reads any of the names below, so this whole block can also be deleted outright
   with zero effect on the rest of ScriptForge. */
const FEATURE_SMART_RECOMMEND = true;

/* SCORE upgrade (Model Advisory & Intelligent Routing) — layered on top of the same
   FEATURE_SMART_RECOMMEND card above, additive-only, same rollback contract.
   ROLLBACK (two levels):
     1. Set SCORE_MODE to false below and redeploy — falls straight back to the exact
        provider-only pick this app already shipped with (SCRIPT_TYPE_RECOMMENDATIONS,
        untouched below). Nothing else changes.
     2. Set FEATURE_SMART_RECOMMEND to false above — hides the whole card, exactly as
        before this upgrade existed.
   MODEL_CAPABILITIES / PRODUCTION_TYPE_WEIGHTS are a static, hand-maintained lookup —
   no live API calls, no new server endpoints, no extra key exposure. Scores are 0–10,
   hand-assigned per each model's real-world strengths; update this table by hand
   whenever a provider ships a new model, same rhythm as VIDEO_COST_PER_SECOND above. */
const SCORE_MODE = true;

const MODEL_CAPABILITIES = [
  { provider: "anthropic", providerLabel: "Anthropic Claude", model: "claude-sonnet-5", modelLabel: "claude-sonnet-5",
    scores: { creative: 9, reasoning: 9, dialogue: 9, storytelling: 9, marketing: 7, coding: 9, education: 8, research: 9, longContext: 9 },
    speed: "fast", cost: "medium" },
  { provider: "anthropic", providerLabel: "Anthropic Claude", model: "claude-haiku-4-5-20251001", modelLabel: "claude-haiku-4-5",
    scores: { creative: 7, reasoning: 7, dialogue: 7, storytelling: 7, marketing: 6, coding: 7, education: 7, research: 6, longContext: 7 },
    speed: "very_fast", cost: "low" },
  { provider: "anthropic", providerLabel: "Anthropic Claude", model: "claude-opus-4-8", modelLabel: "claude-opus-4-8",
    scores: { creative: 10, reasoning: 10, dialogue: 9, storytelling: 10, marketing: 7, coding: 10, education: 9, research: 10, longContext: 10 },
    speed: "slow", cost: "high" },
  { provider: "gemini", providerLabel: "Google Gemini", model: "gemini-2.5-flash", modelLabel: "gemini-2.5-flash",
    scores: { creative: 7, reasoning: 7, dialogue: 7, storytelling: 7, marketing: 7, coding: 7, education: 7, research: 7, longContext: 9 },
    speed: "very_fast", cost: "low" },
  { provider: "gemini", providerLabel: "Google Gemini", model: "gemini-3.6-flash", modelLabel: "gemini-3.6-flash",
    scores: { creative: 8, reasoning: 8, dialogue: 7, storytelling: 8, marketing: 7, coding: 8, education: 7, research: 8, longContext: 9 },
    speed: "very_fast", cost: "low" },
  { provider: "groq", providerLabel: "Groq", model: "llama-3.3-70b-versatile", modelLabel: "llama-3.3-70b-versatile",
    scores: { creative: 10, reasoning: 8, dialogue: 10, storytelling: 10, marketing: 10, coding: 7, education: 7, research: 7, longContext: 8 },
    speed: "very_fast", cost: "low" },
  { provider: "groq", providerLabel: "Groq", model: "openai/gpt-oss-120b", modelLabel: "openai/gpt-oss-120b",
    scores: { creative: 7, reasoning: 9, dialogue: 7, storytelling: 7, marketing: 6, coding: 8, education: 8, research: 8, longContext: 8 },
    speed: "fast", cost: "low" },
  { provider: "deepseek", providerLabel: "DeepSeek", model: "deepseek-v4-flash", modelLabel: "deepseek-v4-flash",
    scores: { creative: 7, reasoning: 8, dialogue: 7, storytelling: 7, marketing: 6, coding: 8, education: 7, research: 7, longContext: 7 },
    speed: "very_fast", cost: "low" },
  { provider: "deepseek", providerLabel: "DeepSeek", model: "deepseek-v4-pro", modelLabel: "deepseek-v4-pro",
    scores: { creative: 8, reasoning: 9, dialogue: 7, storytelling: 8, marketing: 6, coding: 9, education: 8, research: 9, longContext: 8 },
    speed: "medium", cost: "medium" }
];

const PRODUCTION_TYPE_WEIGHTS = {
  "Short Movie Script": { dialogue: .3, storytelling: .3, creative: .2, reasoning: .2 },
  "Short Documentary": { reasoning: .3, longContext: .25, research: .25, education: .2 },
  "Short Advert": { creative: .3, marketing: .3, dialogue: .2, reasoning: .2 },
  "Podcast": { dialogue: .3, longContext: .3, reasoning: .2, creative: .2 },
  "Public Address": { reasoning: .35, education: .25, storytelling: .2, longContext: .2 }
};

const SPEED_RANK = { very_fast: 4, fast: 3, medium: 2, slow: 1 };
const PROVIDER_KEY_FIELD = { anthropic: "apiKey", gemini: "apiKeyGemini", groq: "apiKeyGroq", deepseek: "apiKeyDeepseek" };
const PROVIDER_MODEL_FIELD = { anthropic: "model", gemini: "modelGemini", groq: "modelGroq", deepseek: "modelDeepseek" };

function providerHasKey(provider) {
  const field = PROVIDER_KEY_FIELD[provider];
  const el = field && els[field];
  return !!(el && el.value && el.value.trim().length > 0);
}

/* Weighted dot-product of a model's capability scores against a production type's
   priorities. Weights per type sum to 1 and scores max at 10, so the raw result is
   already a clean 0–10 — confidence is just that number times 10. */
function scoreModel(entry, weights) {
  let total = 0;
  for (const key in weights) total += (entry.scores[key] || 0) * weights[key];
  return total;
}

function computeScoreRecommendation(stype) {
  const weights = PRODUCTION_TYPE_WEIGHTS[stype];
  if (!weights) return null;
  const anyKeyPresent = Object.keys(PROVIDER_KEY_FIELD).some(providerHasKey);
  const pool = anyKeyPresent ? MODEL_CAPABILITIES.filter(m => providerHasKey(m.provider)) : MODEL_CAPABILITIES;
  let best = null, bestScore = -1;
  for (const entry of pool) {
    const s = scoreModel(entry, weights);
    if (s > bestScore || (s === bestScore && SPEED_RANK[entry.speed] > SPEED_RANK[best.speed])) {
      best = entry; bestScore = s;
    }
  }
  if (!best) return null;
  return {
    provider: best.provider, providerLabel: best.providerLabel,
    model: best.model, modelLabel: best.modelLabel,
    confidence: Math.min(99, Math.round(bestScore * 10)),
    speed: best.speed, cost: best.cost,
    keyMissing: !providerHasKey(best.provider)
  };
}

const SPEED_TEXT = { very_fast: "Very fast", fast: "Fast", medium: "Medium", slow: "Slower, higher quality" };
const COST_TEXT = { low: "Low", medium: "Medium", high: "Higher" };

/* Legacy fallback — exactly what this card showed before the SCORE upgrade. Kept
   verbatim so SCORE_MODE=false is a true, zero-surprise rollback. */
const SCRIPT_TYPE_RECOMMENDATIONS = {
  "Short Movie Script": {
    writingKey: "anthropic", writingLabel: "Anthropic Claude",
    writingReason: "Strong structure and pacing for scripted scenes.",
    videoKey: "veo",
    videoTip: "Veo 3.1 usually gives the most realistic camera work and lighting for this style.",
    voiceTip: "A clear, expressive narrator voice works well here."
  },
  "Short Documentary": {
    writingKey: "anthropic", writingLabel: "Anthropic Claude",
    writingReason: "Best suited for documentary narration with strong logical flow.",
    videoKey: "veo",
    videoTip: "Veo 3.1 usually gives the most realistic camera work and lighting for this style.",
    voiceTip: "Aim for a confident, authoritative narration tone."
  },
  "Short Advert": {
    writingKey: "gemini", writingLabel: "Google Gemini",
    writingReason: "Fast, punchy copy suited to short commercial pacing.",
    videoKey: "veo",
    videoTip: "Veo 3.1 or HeyGen both work well — HeyGen if you want one consistent on-camera presenter.",
    voiceTip: "An upbeat, energetic tone usually performs best for ads."
  },
  "Podcast": {
    writingKey: "anthropic", writingLabel: "Anthropic Claude",
    writingReason: "Handles natural, continuous conversation well.",
    videoKey: "veo",
    videoTip: "Veo 3.1 handles the varied camera angles this format needs; HeyGen suits a fixed presenter instead.",
    voiceTip: "Conversational, relaxed energy fits this format best."
  },
  "Public Address": {
    writingKey: "anthropic", writingLabel: "Anthropic Claude",
    writingReason: "Strong at formal, structured rhetoric for a single speaker.",
    videoKey: "heygen",
    videoTip: "HeyGen keeps one consistent presenter on camera throughout, well suited to a formal address.",
    voiceTip: "A steady, authoritative tone suits a public address."
  }
};

let recommendDismissedFor = null;

/* Per-type ElevenLabs voice lock — for these three script types, the voice picker
   auto-selects a fixed voice from the account's real ElevenLabs library so the same voice
   is used every time without re-picking it. Still fully editable afterward: this only sets
   the default value and fires the picker's normal change handler (which persists it exactly
   like a manual pick), it never disables the dropdown. Voice IDs confirmed against the
   account's actual /api/elevenlabs-voices list. */
const SCRIPT_TYPE_VOICE_LOCK = {
  "Short Advert": { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella - Professional, Bright, Warm" },
  "Short Documentary": { id: "gfMQcPgc2SSNR1n6epAr", name: "Kali - AfroGirl authoritative voice" },
  "Public Address": { id: "W4313LXSiFqY7647gYqb", name: "Milan voice clone" }
};

function applyVoiceLock(stype) {
  const lock = SCRIPT_TYPE_VOICE_LOCK[stype];
  if (!lock || !els.elevenLabsVoice) return;
  let opt = [...els.elevenLabsVoice.options].find(o => o.value === lock.id);
  if (!opt) {
    opt = document.createElement("option");
    opt.value = lock.id;
    opt.textContent = lock.name;
    opt.dataset.name = lock.name;
    els.elevenLabsVoice.appendChild(opt);
  }
  els.elevenLabsVoice.value = lock.id;
  els.elevenLabsVoice.dispatchEvent(new Event("change"));
}

/* Per-second provider rates, sourced from each provider's published API pricing (checked
   July 2026): Veo 3.1 standard ~$0.40/s, Grok Imagine ~$0.05/s, HeyGen Video Agent ~$0.033/s
   (roughly $2/min). Earlier version of this estimate used one flat rate for every provider,
   which understated Veo-recommended projects by 3-4x since Veo is the priciest of the three —
   this keeps the number honest per the actual provider being recommended. DEFAULT_CLIP_SECONDS
   matches video-start.js's own default durationSeconds (8) for a single generated clip. */
const VIDEO_COST_PER_SECOND = { veo: 0.40, grok: 0.05, heygen: 0.033 };
const DEFAULT_CLIP_SECONDS = 8;

function estimateRoughCostTime(n, videoKey) {
  const rate = VIDEO_COST_PER_SECOND[videoKey] || VIDEO_COST_PER_SECOND.veo;
  const perSegment = rate * DEFAULT_CLIP_SECONDS;
  const videoLow = n * perSegment * 0.85, videoHigh = n * perSegment * 1.15;
  const costLow = (videoLow + 0.05).toFixed(2), costHigh = (videoHigh + 0.20).toFixed(2);
  const timeLow = Math.max(2, Math.round(n * 0.6)), timeHigh = Math.max(3, Math.round(n * 1.4));
  return { cost: `$${costLow}–$${costHigh}`, time: `~${timeLow}–${timeHigh} min` };
}

function applyScorePick(score, opts) {
  opts = opts || {};
  els.formatProvider.value = score.provider;
  switchFormatProvider();
  const modelField = PROVIDER_MODEL_FIELD[score.provider];
  if (modelField && els[modelField]) els[modelField].value = score.model;
  if (opts.announce) setStatus("info", `Provider set to ${score.providerLabel}, model set to ${score.modelLabel}.`);
}

function renderRecommendation() {
  if (!FEATURE_SMART_RECOMMEND || !els.recommendCard) return;
  const stype = els.scriptType.value;
  const legacy = SCRIPT_TYPE_RECOMMENDATIONS[stype];
  if (!legacy || recommendDismissedFor === stype) {
    els.recommendCard.style.display = "none";
    if (els.apiConfigAutoNote) els.apiConfigAutoNote.textContent = "";
    return;
  }

  const score = SCORE_MODE ? computeScoreRecommendation(stype) : null;
  if (score) {
    els.recWritingLabel.textContent = `${score.providerLabel} — ${score.modelLabel}`;
    els.recWritingReason.textContent = score.keyMissing
      ? `Best match for this production type. Enter your ${score.providerLabel} key above to use it.`
      : legacy.writingReason;
    if (els.recConfidence) els.recConfidence.textContent = `${score.confidence}% match`;
  } else {
    els.recWritingLabel.textContent = legacy.writingLabel;
    els.recWritingReason.textContent = legacy.writingReason;
    if (els.recConfidence) els.recConfidence.textContent = "Excellent";
  }
  els.recVideoTip.textContent = legacy.videoTip;
  els.recVoiceTip.textContent = legacy.voiceTip;
  const est = estimateRoughCostTime(+els.segCount.value || 3, legacy.videoKey);
  const speedCost = score ? ` · ${SPEED_TEXT[score.speed]} · ${COST_TEXT[score.cost]} cost` : "";
  els.recCostTime.textContent = `${est.cost} · ${est.time}${speedCost}`;
  els.recommendCard.style.display = "";
}

/* Auto-apply: as soon as Production Type is picked, the API Configuration card's provider
   (and matching model) jumps straight to the recommended pick — still just a normal dropdown
   the user can change afterward, this only sets its starting value. Fires once per Production
   Type change only (not on every key-input re-render), and never overwrites a provider the
   user has since picked manually for this same script-type selection. ROLLBACK: this whole
   block is additive UI convenience on top of computeScoreRecommendation — deleting it, or
   setting SCORE_MODE to false, leaves renderRecommendation()'s legacy path fully intact. */
let autoAppliedFor = null;
function autoApplyRecommendedProvider(stype) {
  if (!SCORE_MODE) { if (els.apiConfigAutoNote) els.apiConfigAutoNote.textContent = ""; return; }
  const score = computeScoreRecommendation(stype);
  if (els.apiConfigAutoNote) els.apiConfigAutoNote.textContent = "";
  if (!score || autoAppliedFor === stype) return;
  applyScorePick(score, { announce: false });
  autoAppliedFor = stype;
  if (els.apiConfigAutoNote) {
    els.apiConfigAutoNote.textContent = `— auto-set to ${score.providerLabel} for this production type, change anytime`;
  }
}

if (FEATURE_SMART_RECOMMEND && els.recommendCard) {
  els.scriptType.addEventListener("change", () => {
    recommendDismissedFor = null;
    renderRecommendation();
    applyVoiceLock(els.scriptType.value);
    autoApplyRecommendedProvider(els.scriptType.value);
  });
  els.segCount.addEventListener("change", renderRecommendation);
  ["apiKey", "apiKeyGemini", "apiKeyGroq", "apiKeyDeepseek"].forEach(id => {
    if (els[id]) els[id].addEventListener("input", () => SCORE_MODE && renderRecommendation());
  });
  els.formatProvider.addEventListener("change", () => {
    // user took manual control — stop treating the current script type as auto-applied
    autoAppliedFor = null;
    if (els.apiConfigAutoNote) els.apiConfigAutoNote.textContent = "";
  });
  els.btnRecommendUse.addEventListener("click", () => {
    const stype = els.scriptType.value;
    const score = SCORE_MODE ? computeScoreRecommendation(stype) : null;
    if (score) {
      applyScorePick(score, { announce: true });
      autoAppliedFor = stype;
      return;
    }
    const legacy = SCRIPT_TYPE_RECOMMENDATIONS[stype];
    if (!legacy) return;
    els.formatProvider.value = legacy.writingKey;
    switchFormatProvider();
    setStatus("info", `Writing provider set to ${legacy.writingLabel}.`);
  });
  els.btnRecommendDismiss.addEventListener("click", () => {
    recommendDismissedFor = els.scriptType.value;
    els.recommendCard.style.display = "none";
  });
  renderRecommendation();
  applyVoiceLock(els.scriptType.value);
  autoApplyRecommendedProvider(els.scriptType.value);
}

/* remember video-provider keys — each provider gets its own localStorage slot so
   switching between them never overwrites another provider's saved key */
const VIDEO_PROVIDERS = {
  veo:    { keyEl: "videoKeyVeo",    rememberEl: "rememberVideoKeyVeo",    ls: "sf_video_key_veo" },
  grok:   { keyEl: "videoKeyGrok",   rememberEl: "rememberVideoKeyGrok",   ls: "sf_video_key_grok" },
  heygen: { keyEl: "videoKeyHeygen", rememberEl: "rememberVideoKeyHeygen", ls: "sf_video_key_heygen" }
};
Object.values(VIDEO_PROVIDERS).forEach(p => {
  try {
    const saved = localStorage.getItem(p.ls);
    if (saved) { els[p.keyEl].value = saved; els[p.rememberEl].checked = true; }
  } catch (e) {}
  els[p.keyEl].addEventListener("input", () => persistVideoKey(p));
  els[p.rememberEl].addEventListener("change", () => persistVideoKey(p));
});
function persistVideoKey(p) {
  try {
    if (els[p.rememberEl].checked) localStorage.setItem(p.ls, els[p.keyEl].value);
    else localStorage.removeItem(p.ls);
  } catch (e) {}
}

/* ElevenLabs voice-ID picker — same one-slot localStorage key persistence pattern as the
   providers above. IMPORTANT SCOPE NOTE: this only fetches the account's voice list and lets
   the user pick a Voice ID; it never calls ElevenLabs to generate audio. The chosen Voice ID
   is written into the script's TECHNICAL SPECS block (see btnFormat handler below) so it lands
   at the top of the formatted output, ready to hand to whichever TTS/avatar step runs after
   ScriptForge (e.g. pasted into HeyGen, or used with the user's own ElevenLabs workflow). */
try {
  const saved = localStorage.getItem("sf_elevenlabs_key");
  if (saved && els.elevenLabsKey) { els.elevenLabsKey.value = saved; els.rememberElevenLabsKey.checked = true; }
} catch (e) {}
els.rememberElevenLabsKey?.addEventListener("change", persistElevenLabsKey);
els.elevenLabsKey?.addEventListener("input", persistElevenLabsKey);
function persistElevenLabsKey() {
  try {
    if (els.rememberElevenLabsKey.checked) localStorage.setItem("sf_elevenlabs_key", els.elevenLabsKey.value);
    else localStorage.removeItem("sf_elevenlabs_key");
  } catch (e) {}
}

/* Restore a previously picked voice (if any) as a preselected option before the user has even
   fetched the list this session, so the TECHNICAL SPECS line still gets written on Format. */
try {
  const savedVoiceId = localStorage.getItem("sf_elevenlabs_voice_id");
  const savedVoiceName = localStorage.getItem("sf_elevenlabs_voice_name");
  if (savedVoiceId && els.elevenLabsVoice) {
    const opt = document.createElement("option");
    opt.value = savedVoiceId;
    opt.textContent = savedVoiceName || savedVoiceId;
    opt.dataset.name = savedVoiceName || "";
    els.elevenLabsVoice.appendChild(opt);
    els.elevenLabsVoice.value = savedVoiceId;
  }
} catch (e) {}

els.btnFetchVoices?.addEventListener("click", async () => {
  const key = els.elevenLabsKey.value.trim();
  if (!key) {
    els.elevenLabsStatus.className = "status err";
    els.elevenLabsStatus.textContent = "Enter your ElevenLabs API key first (elevenlabs.io → Profile → API Keys).";
    return;
  }
  els.btnFetchVoices.disabled = true;
  els.elevenLabsStatus.className = "status info";
  els.elevenLabsStatus.innerHTML = '<span class="spin"></span>Fetching voices…';
  try {
    const res = await fetch("/api/elevenlabs-voices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    els.elevenLabsVoice.innerHTML = '<option value="">· choose a voice ·</option>';
    (data.voices || []).forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.voice_id;
      opt.textContent = v.name + (v.category ? ` (${v.category})` : "");
      opt.dataset.name = v.name;
      els.elevenLabsVoice.appendChild(opt);
    });
    els.elevenLabsStatus.className = "status ok";
    els.elevenLabsStatus.textContent = `✓ ${data.voices.length} voice(s) loaded, pick one below.`;
  } catch (err) {
    els.elevenLabsStatus.className = "status err";
    els.elevenLabsStatus.textContent = "Error: " + err.message;
  } finally {
    els.btnFetchVoices.disabled = false;
  }
});

els.elevenLabsVoice?.addEventListener("change", () => {
  const opt = els.elevenLabsVoice.selectedOptions[0];
  try {
    if (els.elevenLabsVoice.value) {
      localStorage.setItem("sf_elevenlabs_voice_id", els.elevenLabsVoice.value);
      localStorage.setItem("sf_elevenlabs_voice_name", opt?.dataset.name || "");
    } else {
      localStorage.removeItem("sf_elevenlabs_voice_id");
      localStorage.removeItem("sf_elevenlabs_voice_name");
    }
  } catch (e) {}
});

/* reference image previews (Veo 3.1 "Ingredients to video" — up to 3, optional) */
function wireImageInput(inputEl, previewEl) {
  if (!inputEl || !previewEl) return;
  inputEl.addEventListener("change", () => {
    const f = inputEl.files[0];
    if (!f) { previewEl.style.display = "none"; return; }
    const reader = new FileReader();
    reader.onload = () => { previewEl.src = reader.result; previewEl.style.display = "inline-block"; };
    reader.readAsDataURL(f);
  });
}
wireImageInput(els.refImg1, els.refImg1prev);
wireImageInput(els.refImg2, els.refImg2prev);
wireImageInput(els.refImg3, els.refImg3prev);

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ bytesBase64Encoded: reader.result.split(",")[1], mimeType: file.type || "image/png" });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* Grok Imagine’s reference-to-video mode (docs.x.ai/developers/model-capabilities/video/
   reference-to-video) takes each reference image as {"url": "..."} where that field accepts
   EITHER a public HTTPS URL OR a full base64 data URI directly — same pattern xAI uses for the
   video-edit endpoint’s "video" field. So unlike Veo (which wants the base64 payload split from
   its data-URI prefix), Grok wants the whole "data:image/...;base64,..." string as-is. */
function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ═══════════════ CHARACTER LIBRARY (Phase 1) ═══════════════
   Persistent, client-side-only record per recurring character (age, hair, tone, outfit looks,
   reference images, a compiled anchor phrase) so identity stays locked across segments and
   across generators, instead of being regenerated fresh — and drifting — every segment.

   STORAGE: IndexedDB, not localStorage. The rest of this app's "remember on this device"
   features (API keys, saved scripts in Script Library) use localStorage, but that's typically
   capped around 5-10MB per origin, shared across every key already stored there. A handful of
   characters with 2-3 reference images each can easily reach 1-2MB per character, so this would
   fill or exceed that cap fast — today's fallback for hitting it is a bare "storage full" alert
   (see setLib() above), not something to build an image-heavy feature on top of. IndexedDB has
   no such practical ceiling for this use case. Same guarantee as everything else in this app:
   nothing here is ever sent to or stored on any server.

   PHASE 1 SCOPE NOTE: the original brief for this feature described an auto-generate step that
   would call "the existing T2I generation pathway" to produce reference images from typed
   descriptors. That pathway doesn't exist — ScriptForge has video generation (Veo/Grok/HeyGen)
   but no standalone image-only generation endpoint anywhere in functions/api/. Reference images
   in Phase 1 are manually uploaded, using the same file-to-data-URI pattern already used for the
   segment reference-image inputs above. Auto-generation would need a new server relay (following
   the same no-storage relay pattern as video-start.js) and is left as a clearly separate future
   step, not silently half-built here.

   ROLLBACK: this entire block, the charOverlay/charModal markup in index.html, and the
   "🎭 Characters" button are additive — nothing else in the app reads characterLibrary data
   unless a segment explicitly has library characters selected (see genClip() below). Deleting
   this block, the button, and the modal markup removes the feature with zero effect on anything
   else, exactly like FEATURE_SMART_RECOMMEND's rollback contract elsewhere in this file. */

const CHAR_DB_NAME = "sf_character_library", CHAR_DB_STORE = "characters";
function charDbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CHAR_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(CHAR_DB_STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function charGetAll() {
  try {
    const db = await charDbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CHAR_DB_STORE, "readonly");
      const req = tx.objectStore(CHAR_DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { return []; }
}
async function charGet(id) {
  try {
    const db = await charDbOpen();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(CHAR_DB_STORE, "readonly").objectStore(CHAR_DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { return null; }
}
async function charPut(record) {
  const db = await charDbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAR_DB_STORE, "readwrite");
    tx.objectStore(CHAR_DB_STORE).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}
async function charDelete(id) {
  const db = await charDbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAR_DB_STORE, "readwrite");
    tx.objectStore(CHAR_DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function charSlug(displayName) {
  const base = (displayName || "character").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "character";
  return `${base}-${Math.random().toString(16).slice(2, 6)}`;
}
/* Compiles the single stable identity sentence appended into every T2I/I2V prompt alongside
   this character's reference image(s) — the reference-image-plus-text-anchor pattern the video
   generators already respond to (same principle as FIRST_FRAME_ANCHOR in genClip() below).
   Regenerated whenever base descriptors or the active outfit look change; never rewritten
   per-segment, so it stays a stable, short anchor rather than drifting text. */
function buildAnchorPhrase(c) {
  const outfitKey = c.activeOutfitKey && c.outfitOverride && c.outfitOverride[c.activeOutfitKey] ? c.activeOutfitKey : "default";
  const outfit = (c.outfitOverride && c.outfitOverride[outfitKey]) || "";
  const parts = [];
  if (c.age) parts.push(c.age);
  if (c.appearance) parts.push(c.appearance);
  if (c.hair) parts.push(c.hair);
  if (outfit) parts.push(`wearing ${outfit}`);
  if (c.tone) parts.push(`(${c.tone})`);
  return parts.length ? `${c.displayName || "character"}: ${parts.join(", ")}` : (c.displayName || "");
}

/* ═══════════════ CHARACTER BRIEF IMPORT (bulk parse) ═══════════════
   Deterministic text parser, no API key/server call needed — chosen over routing through the
   user's own AI provider key because the target format (a structured "character bible" brief,
   e.g. from a writers' room doc) is well-structured and self-consistent enough for plain
   regex/string parsing to be fast, free, and reliable. Expects blocks shaped like:
     CHARACTER 1: NAME (Type)
     1. Reference Images
     Image Description
     [appearance paragraph, may contain "NN years old"]
     2. Additional Named Looks
     Look Name
     [description line]
     3. Voice/Tone
     * bullet
     * bullet
     4. Default Outfit
     [paragraph]
     5. Hair
     [paragraph, may be multiple lines]
     6. Anchor Phrase
     [paragraph]
   Section numbers/order are read dynamically (matched by label text, not position), so briefs
   that omit a section or reorder them still parse — missing sections just leave that field
   blank rather than parseCharacterBrief() throwing. ROLLBACK: this whole block plus the
   charImportView wiring further below are additive only — deleting them removes the "Import
   from text" button and view with zero effect on manual character add/edit. */
function titleCaseName(s) {
  return (s || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
function collapseBlockLines(s) {
  return (s || "").split("\n").map(l => l.trim()).filter(Boolean).join(" ");
}
function bulletsToList(s) {
  return (s || "").split("\n").map(l => l.trim().replace(/^[*\-•]\s*/, "")).filter(Boolean).join(", ");
}
function extractAfterLabel(sectionBody, label) {
  const lines = (sectionBody || "").split("\n");
  const idx = lines.findIndex(l => l.trim().toLowerCase() === label.toLowerCase());
  if (idx === -1) return "";
  return lines.slice(idx + 1).join(" ").replace(/\s+/g, " ").trim();
}
function parseNamedLooks(s) {
  const lines = (s || "").split("\n").map(l => l.trim()).filter(Boolean);
  const looks = {};
  let i = 0;
  while (i < lines.length) {
    const nameLine = lines[i], descLine = lines[i + 1];
    if (descLine) {
      const key = nameLine.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      looks[key || `look_${i}`] = descLine.replace(/\.$/, "");
      i += 2;
    } else { i += 1; }
  }
  return looks;
}
function splitNumberedSections(text) {
  const lines = text.split("\n");
  const idxs = [];
  lines.forEach((line, i) => { if (/^\s*\d+\.\s+\S/.test(line)) idxs.push(i); });
  const sections = {};
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i], end = i + 1 < idxs.length ? idxs[i + 1] : lines.length;
    const label = lines[start].replace(/^\s*\d+\.\s+/, "").trim().toLowerCase();
    sections[label] = lines.slice(start + 1, end).join("\n").trim();
  }
  return sections;
}
function parseCharacterBlock(name, type, blockText) {
  const sections = splitNumberedSections(blockText);
  const refSection = sections["reference images"] || "";
  const appearance = extractAfterLabel(refSection, "Image Description") || collapseBlockLines(refSection);
  const ageMatch = appearance.match(/\d{1,3}\s*years?\s*old/i);
  const age = ageMatch ? ageMatch[0] : "";
  const hair = collapseBlockLines(sections["hair"] || "");
  const tone = bulletsToList(sections["voice/tone"] || sections["voice / tone"] || "");
  const outfitDefault = collapseBlockLines(sections["default outfit"] || "");
  const outfitExtra = parseNamedLooks(sections["additional named looks"] || "");
  const anchorPhrase = collapseBlockLines(sections["anchor phrase"] || "");
  const outfitOverride = Object.assign({ default: outfitDefault }, outfitExtra);
  return {
    id: charSlug(name), displayName: name, characterType: type, productionTypes: [],
    age, appearance, hair, tone, elevenLabsVoiceId: "", referenceImages: {},
    outfitOverride, activeOutfitKey: "default", anchorPhrase,
    lastUpdated: new Date().toISOString().slice(0, 10)
  };
}
function parseCharacterBrief(text) {
  const lines = (text || "").replace(/\r\n/g, "\n").split("\n");
  const headerIdxs = [], headerMatches = [];
  lines.forEach((line, i) => {
    const m = line.match(/^CHARACTER\s+\d+\s*:\s*([^\(]+?)\s*(?:\(([^)]*)\))?\s*$/i);
    if (m) { headerIdxs.push(i); headerMatches.push(m); }
  });
  const chars = [];
  for (let b = 0; b < headerIdxs.length; b++) {
    const start = headerIdxs[b], end = b + 1 < headerIdxs.length ? headerIdxs[b + 1] : lines.length;
    const name = titleCaseName(headerMatches[b][1].trim());
    const type = (headerMatches[b][2] || "").trim();
    chars.push(parseCharacterBlock(name, type, lines.slice(start + 1, end).join("\n")));
  }
  return chars;
}

/* CHARACTER CONTINUITY + ELEVENLABS AUDIO HELPERS (see genClip() below for where these are
used). extractLastFrame grabs the final frame of a just-finished Veo/Grok clip client-side —
Cloudflare's Workers runtime (where every /api/* relay in this app runs) has no video codec
support at all, so there is no way to decode a frame server-side; the browser already has the
finished clip's bytes by the time this runs, so that's the only place this can happen. */
function extractLastFrame(videoBlobUrl) {
return new Promise((resolve) => {
const v = document.createElement("video");
v.muted = true;
v.playsInline = true;
v.src = videoBlobUrl;
v.addEventListener("loadedmetadata", () => {
v.currentTime = Math.max(0, v.duration - 0.15);
});
v.addEventListener("seeked", () => {
try {
const canvas = document.createElement("canvas");
canvas.width = v.videoWidth;
canvas.height = v.videoHeight;
canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
canvas.toBlob(blob => resolve(blob), "image/png");
} catch (e) { resolve(null); }
});
v.addEventListener("error", () => resolve(null));
});
}
function showChainOption(nextNum) {
const wrap = $("chainWrap" + nextNum);
if (!wrap) return;
wrap.style.display = "flex";
const thumb = $("chainThumb" + nextNum);
if (thumb && chainFrames[nextNum]) {
const url = URL.createObjectURL(chainFrames[nextNum]);
thumb.innerHTML = `<img src="${url}" style="max-width:70px;border-radius:6px;margin-top:4px">`;
}
}
/* ElevenLabs text-to-speech relay call — see functions/api/elevenlabs-tts.js. Used by
genClip() below either to feed HeyGen's audio-driven avatar mode (real voice + lip-sync
consistency) or, for Veo/Grok which can't accept external audio at all, to offer the
narration as a separate download to mux in your own editor. */
async function fetchElevenTTS(voiceId, apiKey, text) {
const res = await fetch("/api/elevenlabs-tts", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ apiKey, voiceId, text })
});
if (!res.ok) {
const errData = await res.json().catch(() => null);
throw new Error(errData?.error?.message || `ElevenLabs TTS failed: HTTP ${res.status}`);
}
return await res.blob();
}
function blobToBase64(blob) {
return new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = () => resolve(reader.result.split(",")[1]);
reader.onerror = reject;
reader.readAsDataURL(blob);
});
}

/* word meter */
els.script.addEventListener("input", updateWordMeter);
els.segCount.addEventListener("change", updateLengthUI);
function updateWordMeter(){
  const n = +els.segCount.value, total = segEndTime(n);
  const lo = Math.round(total*2.5*0.88), hi = Math.round(total*2.5*1.12);
  const w = els.script.value.trim().split(/\s+/).filter(Boolean).length;
  els.wordMeter.textContent = `${w} words · target ≈ ${lo}–${hi} words for ${tstamp(total)}` + (w > Math.round(hi*1.2) ? " · ⚠ likely over target, formatter will condense" : "");
}
function updateLengthUI(){
  const n = +els.segCount.value, total = segEndTime(n);
  const durNote = n <= 3 ? "10s each" : "10s ×3, then 15s each";
  els.lenBadge.textContent = `00:00 – ${tstamp(total)} · ${n} segments · ${durNote}`;
  els.btnFormat.textContent = `⚡ Format into ${n} Segment${n>1?'s':''} (${tstamp(total)})`;
  updateWordMeter();
}

function setStatus(cls, html){
  els.status.className = "status " + cls;
  els.status.innerHTML = html;
}

/* ─────────────────────────  FORMAT (via our own server — avoids browser CORS/
   extension interference; see functions/api/format.js for the relay + the
   data-handling note on why this changed from a direct browser→Anthropic call)
   ───────────────────────── */
/* Provider metadata for the "Format" call — mirrors VIDEO_PROVIDERS' shape but keyed to the
   script-writing providers instead. keyUrl/label feed the error messages below so a wrong or
   missing key points people at the right place regardless of which provider they picked. */
const FORMAT_PROVIDER_META = {
  anthropic: { label: "Anthropic", keyEl: "apiKey",         modelEl: "model",         keyUrl: "console.anthropic.com/settings/keys" },
  gemini:    { label: "Gemini",    keyEl: "apiKeyGemini",    modelEl: "modelGemini",   keyUrl: "aistudio.google.com/apikey" },
  groq:      { label: "Groq",      keyEl: "apiKeyGroq",      modelEl: "modelGroq",     keyUrl: "console.groq.com/keys" },
  deepseek:  { label: "DeepSeek",  keyEl: "apiKeyDeepseek",  modelEl: "modelDeepseek", keyUrl: "platform.deepseek.com/api_keys" }
};

/* Output-token ceiling, per provider (and per model where a provider's models differ). Long
   pasted scripts were never actually being truncated on the way IN — script text always went
   through format.js to the upstream provider verbatim (confirmed by re-reading the relay: it
   only strips em dashes from the response, nothing touches the request body). The real risk was
   on the way OUT: this used to be one flat `Math.min(1500 + n*800, 16000)` for every provider,
   which for large segment counts (up to 21) could sit right at or above what a given provider's
   API actually allows, or simply not leave the model enough room to finish every segment's 7
   fields without the response getting cut off mid-generation. Ceilings below are each provider's
   real published max output tokens (checked July 2026): Anthropic Claude Sonnet 5 = 64k, Gemini
   2.5/3.6 Flash = ~65.5k, Groq llama-3.3-70b-versatile = 32,768 / openai/gpt-oss-120b = 65,536,
   DeepSeek's standard (non-beta) chat completions endpoint is far more limited than its 384k
   model ceiling implies, so it's kept conservative to avoid a 400 from requesting more than the
   endpoint actually accepts. Requested tokens still scale with segment count so small jobs don't
   over-ask, they just aren't clamped down below what a large job legitimately needs anymore. */
const PROVIDER_MAX_OUTPUT_TOKENS = {
  anthropic: 64000,
  gemini: 65000,
  groq: { default: 32000, "openai/gpt-oss-120b": 65000 },
  deepseek: 8000
};
function computeMaxTokens(n, provider, model) {
  const requested = 2000 + n * 900;
  let ceiling = PROVIDER_MAX_OUTPUT_TOKENS[provider];
  if (ceiling && typeof ceiling === "object") ceiling = ceiling[model] || ceiling.default;
  return Math.min(requested, ceiling || 16000);
}

els.btnFormat.addEventListener("click", async () => {
  const provider = els.formatProvider.value;
  const pmeta = FORMAT_PROVIDER_META[provider];
  const key = els[pmeta.keyEl].value.trim();
  const script = els.script.value.trim();
  if (!key || (provider === "anthropic" && key === "sk-ant-YOUR_KEY_HERE")) { setStatus("err", `Enter your ${pmeta.label} API key (${pmeta.keyUrl}).`); return; }
  if (!script) { setStatus("err", "Paste a script first."); return; }

  const n = +els.segCount.value;
  if (n > FREE_MAX_SEGS && tier !== "pro") { showUpgrade("Segments beyond " + FREE_MAX_SEGS + " × 10s are a Pro feature."); return; }
  const ratio = els.ratio.value;
  const stype = els.scriptType.value;
  const allowBRoll = els.allowBRoll ? els.allowBRoll.checked : true;
  let specs = "";
  if (stype) specs += `Script type: ${stype}\n`;
  specs += `Ratio: ${ratio}\n`;
  if (!allowBRoll) specs += `B-Roll: disabled\n`;
  if (els.techSpecs.value.trim()) specs += `Specs: ${els.techSpecs.value.trim()}\n`;
  if (els.elevenLabsVoice?.value) {
    const voiceName = els.elevenLabsVoice.selectedOptions[0]?.dataset.name || "";
    specs += `ElevenLabs Voice ID: ${els.elevenLabsVoice.value}${voiceName ? " (" + voiceName + ")" : ""}\n`;
  }

  /* PODCAST gets its own dedicated instruction block rather than just the generic
     "FORMAT STYLE: adapt tone" line below — a podcast isn't a sequence of separate scenes,
     it's one continuous conversation that happens to be cut into 10-second boundaries, so the
     model needs to be told explicitly not to treat each segment as a fresh scene. Craft sentences
     (conversational authenticity, audio-first language, host pacing) were folded straight into
     this block rather than routed through CRAFT_BLOCKS below, since podcast also carries a real
     structural requirement (the "IMPORTANT" segment-per-turn sentence) that the other four types
     don't need — keeping that requirement and its craft guidance together in one block avoids
     splitting a single format's instructions across two separate places in the prompt. */
  const podcastBlock = stype === "Podcast"
    ? `PODCAST FORMAT — DEDICATED INSTRUCTIONS: this is a continuous conversational podcast/banter about a single theme or subject, not a series of separate scenes. Treat the whole script as one ongoing conversation split purely by the segment timing boundaries (10s for segments 1-3, 15s from segment 4 onward), not by topic or scene changes, every segment should feel like a natural continuation of the moment right before it, mid-sentence energy is fine. Speakers should sound like they are genuinely reacting to, building on, or riffing off whatever was just said. Conversational authenticity is the top priority: natural turn-taking, real overlaps or interruptions where they fit, contractions, and audio-first descriptive language in any narration since there is no visual for the listener to lean on. Note host energy and pacing explicitly where it matters, a pause, a raised-emphasis word, a tonal shift, since podcast delivery lives or dies on rhythm. Vary the camera position, framing, and angle across segments (wide two-shot, closer single, alternate angle, etc.) so the scene stays visually dynamic even though the setting and speakers stay the same, never lock the camera to one static angle for the whole episode. IMPORTANT: this continuity applies ONLY to the tone and content, you must still output every single segment as its own separate "### SEGMENT [NUMBER] | [START]-[END]" header with all 8 required fields (Type, TTS Script, Text-to-Image Prompt, Image-to-Video Prompt, Camera Movement, Lighting, Mood, Audio Note) filled in exactly as specified in the structure above. Never merge multiple segments into one block, never omit a segment header, and never write the conversation as one continuous unbroken paragraph, the discrete segment structure is mandatory even though the conversation itself should read continuously across them.\n\n`
    : "";

  /* Per-production-type craft layer, additive on top of the shared base standards already in
     buildSystemPrompt()'s system message (environment/atmosphere, sustained mood, spoken
     dialogue, distinct character voices, show-don't-summarize) — those apply to every type
     already, this only adds the specific craft conventions unique to each format. Podcast is
     handled separately above via podcastBlock since it also carries a structural requirement,
     not just craft guidance. Keyed by the exact Production Type values used elsewhere in this
     file (SCRIPT_TYPE_RECOMMENDATIONS, SCRIPT_TYPE_VOICE_LOCK), so this only ever fires for a
     real, selected type — "— None / generic —" (stype === "") intentionally gets no block. */
  const CRAFT_BLOCKS = {
    "Short Movie Script": `SHORT MOVIE SCRIPT — CRAFT INSTRUCTIONS: write this like a produced screenplay, not a plot summary. Action and scene description (carried in the TTS Script/narration where a segment is not pure dialogue) should read cinematically: specific, visual, and economical, never padded or generic. Favor subtext over exposition, characters should rarely say exactly what they mean, let intention come through behavior, word choice, and what's left unsaid. Every scene should feel deliberately staged with real atmosphere, not a flat account of what happens in it.\n\n`,
    "Short Documentary": `SHORT DOCUMENTARY — CRAFT INSTRUCTIONS: narration should carry literary weight without losing its informational job, it still has to teach the viewer something true. Voiceover + B-Roll segments should paint the environment richly enough that the described visual and the narration reinforce each other rather than repeating the same idea twice in different words. On-camera or interview-style segments should preserve natural human speech patterns, hesitation, emphasis, real phrasing, rather than reading like a scripted announcement, even when the speaker is a reconstructed or composite figure.\n\n`,
    "Short Advert": `SHORT ADVERT — CRAFT INSTRUCTIONS: this must function as an actual advertisement that makes someone want to buy the product, not a scenic travelogue or a diary narration of someone's day that happens to feature the brand. A line like "I'm here enjoying a cold Coca Cola" describes an experience, it does not pitch anything, it names the brand without selling it. Every ad needs real persuasive work: a hook that grabs attention or sparks curiosity early, a genuine reason to want the product (a feeling, a benefit, a craving, not just its name), and a definite call to action at the close, try it, grab one, taste it, share one, and so on, not a scene that simply ends. This ad is exactly ${n} segment${n > 1 ? "s" : ""} long. ${n > 1 ? `Structure the arc across all ${n} segments: earlier segments can build curiosity or atmosphere, but Segment ${n} specifically, the final segment, MUST land the actual call to action out loud in its TTS Script, explicitly inviting the viewer to act (try it, grab one, taste it, and so on), not just end on a nice image or atmosphere. Use the "On-Camera + Brand Close" Type specifically for this final segment to signal it is the closing brand moment.` : `Since this is a single-segment ad, this one segment alone must accomplish all three: the hook, the pitch, and the call to action, within its word-count budget, it has no later segment to defer the close to.`} Atmosphere alone anywhere in the ad, with no segment ever landing a real call to action, fails the assignment no matter how well-crafted the prose is. Every single word must earn its place given the tight runtime, that means dense with real persuasive substance, not sparse or empty. Still use close to the full word-count budget available for the segment's duration (see rule 6), a bare slogan fragment like a product name plus a location is never enough on its own, every segment needs an actual line with a genuine emotional hook, sensory pull, or reason to want the product, not a caption. Atmosphere and mood still apply but must be compressed into a tight emotional hook rather than a slow build, and must always serve the advertised brand or product, never replace it. The specific brand or product named in the input must be clearly present and named on screen or in the TTS Script starting from the very first segment, not saved for a reveal at the end and not diluted into generic unbranded scenery, a viewer should know exactly what is being advertised within the first few seconds. If the Type is On-Camera or On-Camera + Brand Close, the subject actually speaks the line to camera, per the shared On-Camera rule, most short adverts should use this direct-to-camera spokesperson delivery since it is the most persuasive and memorable option, favor it unless the input clearly calls for pure voiceover instead. Every Image-to-Video Prompt must still give the subject and product real physical energy and kinetic specificity, a confident dynamic gesture, a satisfying dynamic product action like a pour, a fizzy open, or a decisive stride, genuine movement with momentum, never a passive static beat, but stage that product action as its own beat before or after the spoken line rather than layered on top of it, since a person cannot speak clearly while their mouth is on the product. An advert has to feel alive and kinetic on screen, not posed or still, that energy is what makes it memorable, not just the visual composition. End on a clear, resonant closing line or call to action that names the brand and lands with real impact, never trail off or fade out on scenery without landing on something.\n\n`,
    "Public Address": `PUBLIC ADDRESS — CRAFT INSTRUCTIONS: write with real rhetorical craft, deliberate repetition, escalating structure, and a clear emotional through-line that builds to a climactic point, the way a speechwriter paces a delivered speech. Vary sentence length and rhythm intentionally rather than using uniform sentence structure throughout, short sentences for impact, longer ones to build momentum.\n\n`
  };
  const craftBlock = CRAFT_BLOCKS[stype] || "";

  const userMsg = (specs ? `TECHNICAL SPECS PROVIDED (include at very top of output):\n${specs}\n` : "") +
                  podcastBlock +
                  craftBlock +
                  (stype ? `FORMAT STYLE: ${stype}. Adapt the Type fields, pacing and tone of every segment to a ${stype.toLowerCase()}.\n\n` : "") +
                  (allowBRoll ? "" : "B-ROLL DISABLED: do not produce any Voiceover + B-Roll segments, every segment must be On-Camera or On-Camera + Brand Close, with the presenter/subject visible throughout.\n\n") +
                  `Now process this script:\n\n${script}`;

  els.btnFormat.disabled = true;
  setStatus("info", `<span class="spin"></span>Calling ${pmeta.label}… splitting into ${n} × 10s segments`);

  async function callFormat() {
    return fetch("/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        apiKey: key,
        model: els[pmeta.modelEl].value,
        max_tokens: computeMaxTokens(n, provider, els[pmeta.modelEl].value),
        system: buildSystemPrompt(n, ratio, allowBRoll),
        messages: [{ role: "user", content: userMsg }]
      })
    });
  }

  try {
    let res;
    try {
      res = await callFormat();
    } catch (networkErr) {
      // Same-origin call to our own server — a thrown TypeError here means a
      // brief network hiccup reaching tahastudiolabs.com itself, not anything
      // Anthropic- or extension-related. Safe to retry once.
      await new Promise(r => setTimeout(r, 900));
      res = await callFormat();
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    lastRaw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    if (!lastRaw) throw new Error("Empty response from API.");
    lastMeta = { n, ratio, type: stype, date: new Date().toISOString() };
    renderOutput(lastRaw);
    els.btnSaveLib.style.display = "inline-block"; els.btnPdf.style.display = "inline-block";
    els.btnSaveLib.textContent = "💾 Save to Library";
    setStatus("ok", `✓ Done — ${n} segments generated. Copy blocks are ready below.`);
  } catch (err) {
    setStatus("err", "API error: " + err.message + `<br>Check that your key is valid at ${pmeta.keyUrl}, or try again in a moment.`);
  } finally {
    els.btnFormat.disabled = false;
  }
});

/* ─────────────────────────  RENDER  ───────────────────────── */
function renderOutput(raw){
  els.rawOut.value = raw;
  els.btnToggleRaw.style.display = "inline-block";
  els.btnCopyAll.style.display = "inline-block";
  els.output.style.display = "block";
  els.rawOut.style.display = "none";
  els.btnToggleRaw.textContent = "View raw markdown";

  const html = [];

  /* Technical specs block (anything before first "### SEGMENT"). Kept verbatim in
     window.__specsBlock so rebuildLastRaw() below can re-prepend it exactly as generated
     every time an editable field changes, without needing to re-parse it from the DOM. */
  const firstSeg = raw.search(/###\s*SEGMENT/i);
  window.__specsBlock = firstSeg > 0 ? raw.slice(0, firstSeg).replace(/^-+\s*$/gm, "").trim() : "";
  if (window.__specsBlock) {
    html.push(`<div class="specs-block"><div class="fl">Technical Specs</div>${esc(window.__specsBlock).replace(/\*\*/g,"")}</div>`);
  }

  /* Segments */
  window.__segPrompts = {};
  const segRe = /###\s*SEGMENT\s*(\d+)\s*\|\s*([^\n]+)\n([\s\S]*?)(?=###\s*SEGMENT|\s*$)/gi;
  let m, found = 0;
  while ((m = segRe.exec(raw)) !== null) {
    found++;
    const num = m[1], time = m[2].trim(), body = m[3];
    /* 5-field B-roll model (Text-to-Image / Image-to-Video / Camera Movement / Lighting / Mood)
       replaces the old 2-field "Visual / B-Roll Prompt" + "Motion" pair so the video generator
       gets the still composition, the motion, the camera work, the lighting, and the mood as
       distinct instructions instead of one blob of text. Old labels are kept as a fallback so
       scripts already saved to a user's Library before this change still render correctly. */
    const t2iPrompt = pick(body, "Text-to-Image Prompt") || pick(body, "Visual / B-Roll Prompt") || pick(body, "Visual");
    const i2vPrompt = pick(body, "Image-to-Video Prompt");
    const camera = pick(body, "Camera Movement") || pick(body, "Motion");
    const lighting = pick(body, "Lighting");
    const mood = pick(body, "Mood");
    const segType = pick(body, "Type");
    const ttsScript = pick(body, "TTS Script");
    const audioNote = pick(body, "Audio Note");
    /* time + num are kept on the object (not just used locally) so serializeSegment() below
       can rebuild a correct "### SEGMENT N | TIME" header purely from this object, live, on
       every keystroke, with no dependency on the original AI-generated text ever again. */
    window.__segPrompts[num] = { num, time, t2iPrompt, i2vPrompt, camera, lighting, mood, ttsScript, audioNote, segType };
    /* Every field renders as an editable textarea (not a read-only div) so the user can bring
       their own touch to the TTS script, prompts, or any other field before either copying the
       block, saving it, or hitting Generate clip, everything downstream (Copy full output,
       Save to Library, Download PDF, genClip) reads from this same live-edited object/lastRaw,
       never from the original frozen AI text. */
    const fields = [
      ["Type",                  segType,   "",        "segType"],
      ["TTS Script",            ttsScript, "tts",     "ttsScript"],
      ["Text-to-Image Prompt",  t2iPrompt, "visual",  "t2iPrompt"],
      ["Image-to-Video Prompt", i2vPrompt, "visual",  "i2vPrompt"],
      ["Camera Movement",       camera,    "",        "camera"],
      ["Lighting",              lighting,  "",        "lighting"],
      ["Mood",                  mood,      "",        "mood"],
      ["Audio Note",            audioNote, "",        "audioNote"]
    ];
    let inner = "";
    for (const [lab, val, cls, key] of fields) {
      const rows = (key === "ttsScript" || key === "t2iPrompt" || key === "i2vPrompt") ? 3 : (key === "segType" ? 1 : 2);
      inner += `<div class="field ${cls}"><div class="fl">${lab}</div><textarea class="fv fv-edit" data-num="${num}" data-field="${key}" rows="${rows}">${esc(val)}</textarea></div>`;
    }
    html.push(
      `<div class="seg-card">
         <div class="seg-head">
           <div class="t">SEGMENT ${num}<small>${esc(time)}</small></div>
           <button class="btn-copy" data-action="copy-block" data-num="${num}">📋 Copy block</button>
         </div>
         <div class="seg-body">${inner}</div>
         ${t2iPrompt ? `
         <div class="seg-video" style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
           <div style="display:flex;gap:8px;align-items:center">
             <select id="vidGen${num}" style="flex:1">
               <option value="veo">Veo 3.1</option>
               <option value="grok">Grok Imagine</option>
               <option value="heygen">HeyGen Video Agent</option>
             </select>
             <input type="number" id="vidDur${num}" min="1" max="15" step="1" value="15" style="width:52px" title="Clip length in seconds. Grok Imagine allows 1-15s (this dropdown only applies to Grok — Veo 3.1 is fixed at 8s per call, and HeyGen has no formal duration parameter).">
             <button class="btn-copy" data-action="gen-clip" data-num="${num}">🎬 Generate clip</button>
           </div>
           <div class="status" id="vidStatus${num}"></div>
<div id="charPickWrap${num}"></div>
<label id="chainWrap${num}" style="display:none;align-items:center;gap:6px;font-size:.72rem;margin-top:6px;cursor:pointer"><input type="checkbox" id="chainUse${num}" checked style="width:auto"> 🔗 Use Segment ${Number(num)-1}'s final frame as this segment's character reference (Veo/Grok)</label>
<div id="chainThumb${num}"></div>
           <div id="vidResult${num}" style="margin-top:8px"></div>
         </div>` : ""}
       </div>`
    );
  }

  els.output.innerHTML = found
    ? html.join("")
    : `<div class="specs-block"><div class="fl">Raw output</div>${esc(raw)}</div>`;
  if (found && window.populateSegmentCharPickers) window.populateSegmentCharPickers();
}

/* Delegated click handling for the output panel. The site's Content-Security-Policy is
   script-src 'self' (no 'unsafe-inline'), which silently blocks inline onclick="" attributes
   in the browser — buttons still look clickable but their handler never fires. This was
   true for the pre-existing "Copy block" button too, not just the new video one. Using one
   listener on the stable container + data-attributes on the buttons is CSP-safe and only
   needs to be wired once, regardless of how many segment cards get re-rendered. */
els.output.addEventListener("click", (e) => {
  const copyBtn = e.target.closest('[data-action="copy-block"]');
  if (copyBtn) { copyText(copyBtn, serializeSegment(copyBtn.dataset.num)); return; }
  const genBtn = e.target.closest('[data-action="gen-clip"]');
  if (genBtn) { genClip(Number(genBtn.dataset.num), genBtn); return; }
});

/* Delegated input handling — fires on every keystroke in any editable field textarea. Updates
   the live window.__segPrompts object (which genClip() already reads from) and recomputes
   lastRaw (which Copy full output / Save to Library / Download PDF all read from), so every
   downstream consumer of the output picks up the user's edits with zero changes of its own. */
els.output.addEventListener("input", (e) => {
  const t = e.target;
  if (!t.classList || !t.classList.contains("fv-edit")) return;
  const num = t.dataset.num, field = t.dataset.field;
  if (window.__segPrompts && window.__segPrompts[num]) {
    window.__segPrompts[num][field] = t.value;
    rebuildLastRaw();
  }
});

/* Rebuilds one segment's full "### SEGMENT N | TIME" markdown block straight from the live
   window.__segPrompts object, matching the exact label/blockquote format the AI providers
   output (and that pick() above parses back in), so an edited segment round-trips identically
   through Copy block / Save to Library / reload from Library. */
function serializeSegment(num){
  const seg = window.__segPrompts && window.__segPrompts[num];
  if (!seg) return "";
  /* bq(): if the user pressed Enter inside an edited field, continuation lines must also be
     blockquoted ("> ") or pick() will drop everything after the first newline when the block
     is re-parsed on Library reload. inline(): the Type field is serialized inline (no
     blockquote), so newlines there are collapsed to spaces instead. */
  const bq = v => String(v ?? "").replace(/\n/g, "\n> ");
  const inline = v => String(v ?? "").replace(/\s*\n\s*/g, " ");
  return `### SEGMENT ${seg.num} | ${seg.time}
**Type**: ${inline(seg.segType)}

**TTS Script**:
> ${bq(seg.ttsScript)}

**Text-to-Image Prompt**:
> ${bq(seg.t2iPrompt)}

**Image-to-Video Prompt**:
> ${bq(seg.i2vPrompt)}

**Camera Movement**:
> ${bq(seg.camera)}

**Lighting**:
> ${bq(seg.lighting)}

**Mood**:
> ${bq(seg.mood)}

**Audio Note**:
> ${bq(seg.audioNote)}`;
}

/* Recomputes lastRaw (the source for Copy full output / Save to Library / Download PDF) from
   window.__specsBlock + every live segment, in segment-number order, every time an editable
   field changes. This is the one place lastRaw gets reassigned after the initial format call. */
function rebuildLastRaw(){
  const nums = Object.keys(window.__segPrompts || {}).map(Number).sort((a,b) => a - b);
  const segsMd = nums.map(n => serializeSegment(n)).join("\n\n---\n\n");
  lastRaw = (window.__specsBlock ? window.__specsBlock + "\n\n---\n\n" : "") + segsMd;
  els.rawOut.value = lastRaw;
}

function pick(body, label){
  const re = new RegExp("\\*\\*" + label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "\\*\\*\\s*:?\\s*\\n?((?:>[^\\n]*\\n?)+|[^\\n*]+)", "i");
  const m = body.match(re);
  if (!m) return "";
  return m[1].replace(/^>\s?/gm, "").trim();
}
function esc(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

/* ─────────────────────────  COPY / TOGGLE / CLEAR  ───────────────────────── */
window.copyText = function(btn, text){
  navigator.clipboard.writeText(text).then(() => {
    const o = btn.textContent; btn.textContent = "✓ Copied";
    setTimeout(() => btn.textContent = o, 1400);
  });
};
els.btnCopyAll.addEventListener("click", () => copyText(els.btnCopyAll, lastRaw));
els.btnToggleRaw.addEventListener("click", () => {
  const showRaw = els.rawOut.style.display === "none";
  els.rawOut.style.display = showRaw ? "block" : "none";
  els.output.style.display = showRaw ? "none" : "block";
  els.btnToggleRaw.textContent = showRaw ? "View formatted" : "View raw markdown";
});
els.btnClear.addEventListener("click", () => {
  els.script.value = ""; els.output.innerHTML = '<div class="empty">Formatted segments will appear here.</div>';
  els.rawOut.value = ""; lastRaw = "";
  els.btnToggleRaw.style.display = "none"; els.btnCopyAll.style.display = "none";
  els.btnSaveLib.style.display = "none"; els.btnPdf.style.display = "none"; lastMeta = null;
  els.status.className = "status"; updateWordMeter();
});
/* ─────────────────────────  LIBRARY & PDF  ───────────────────────── */
function getLib(){ try { return JSON.parse(localStorage.getItem("sca_fmt_library") || "[]"); } catch(e){ return []; } }
function setLib(list){ try { localStorage.setItem("sca_fmt_library", JSON.stringify(list)); } catch(e){ alert("Could not save — storage full or blocked."); } }
function titleFor(raw, meta){
  const m = raw.match(/\*\*TTS Script\*\*:\s*\n?>?\s*([^\n]+)/i);
  const base = m ? m[1].replace(/[>*"]/g,"").trim().split(/\s+/).slice(0,8).join(" ") : "Untitled script";
  return `${meta && meta.type ? meta.type + " · " : ""}${base}`;
}
els.btnSaveLib.addEventListener("click", () => {
  if (!lastRaw) return;
  const lib = getLib();
  if (tier !== "pro" && lib.length >= FREE_LIB_CAP) { showUpgrade("The free Library holds " + FREE_LIB_CAP + " scripts. Pro removes the limit."); return; }
  lib.unshift({ id: Date.now(), title: titleFor(lastRaw, lastMeta), meta: lastMeta, raw: lastRaw });
  setLib(lib);
  els.btnSaveLib.textContent = "✓ Saved";
});
els.btnLibrary.addEventListener("click", () => { renderLib(); els.libOverlay.classList.add("open"); });
els.btnLibClose.addEventListener("click", () => els.libOverlay.classList.remove("open"));
els.libOverlay.addEventListener("click", e => { if (e.target === els.libOverlay) els.libOverlay.classList.remove("open"); });
function renderLib(){
  const lib = getLib();
  if (!lib.length) { els.libList.innerHTML = '<div class="lib-empty">No saved scripts yet.<br>Format a script, then hit 💾 Save to Library.</div>'; return; }
  els.libList.innerHTML = lib.map(item => `
    <div class="lib-item">
      <div class="meta">
        <div class="t">${esc(item.title)}</div>
        <div class="d">${new Date((item.meta && item.meta.date) || item.id).toLocaleString()}${item.meta && item.meta.n ? " · " + item.meta.n + " segments · " + tstamp(segEndTime(item.meta.n)) : ""}${item.meta && (item.meta.ratio || item.meta.avatar) ? " · " + esc(item.meta.ratio || item.meta.avatar) : ""}</div>
      </div>
      <button class="btn-copy" data-action="lib-open" data-id="${item.id}">Open</button>
      <button class="btn-copy" data-action="lib-pdf" data-id="${item.id}">⬇ PDF</button>
      <button class="btn-copy" style="color:var(--err)" data-action="lib-del" data-id="${item.id}">Delete</button>
    </div>`).join("");
}
els.libList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.action === "lib-open") libLoad(id);
  else if (btn.dataset.action === "lib-pdf") libPdf(id);
  else if (btn.dataset.action === "lib-del") libDel(id);
});
window.libLoad = function(id){
  const item = getLib().find(x => x.id === id); if (!item) return;
  lastRaw = item.raw; lastMeta = item.meta;
  renderOutput(lastRaw);
  els.btnSaveLib.style.display = "inline-block"; els.btnPdf.style.display = "inline-block";
  els.btnSaveLib.textContent = "💾 Save to Library";
  els.libOverlay.classList.remove("open");
  setStatus("ok", "✓ Loaded from Library: " + esc(item.title));
};
/* ═══════════════ CHARACTER LIBRARY UI (Phase 1) ═══════════════
   List/form controller for the modal built in index.html. Storage functions (charGetAll/
   charGet/charPut/charDelete) and buildAnchorPhrase() are defined earlier in this file. */
let charDraft = null; // in-memory record being edited, including any newly-uploaded image data URIs

async function renderCharList() {
  const chars = await charGetAll();
  if (!chars.length) {
    els.charList.innerHTML = '<div class="lib-empty">No characters saved yet.<br>Click "+ New Character" to add one.</div>';
    return;
  }
  els.charList.innerHTML = chars.map(c => `
    <div class="lib-item">
      ${c.referenceImages && c.referenceImages.front ? `<img src="${c.referenceImages.front}" style="width:44px;height:44px;object-fit:cover;border-radius:6px">` : `<div style="width:44px;height:44px;border-radius:6px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:1.2rem">🎭</div>`}
      <div class="meta">
        <div class="t">${esc(c.displayName || "Untitled")}</div>
        <div class="d">${esc(c.characterType || "unspecified")}${c.productionTypes && c.productionTypes.length ? " · " + esc(c.productionTypes.join(", ")) : ""}</div>
      </div>
      <button class="btn-copy" data-action="char-edit" data-id="${c.id}">Edit</button>
    </div>`).join("");
}
els.charList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "char-edit") openCharForm(btn.dataset.id);
});

function outfitExtraRowHtml(key, val) {
  return `<div class="row outfit-extra-row" style="gap:6px;margin-bottom:6px">
    <input type="text" class="outfit-key" placeholder="look name, e.g. flashback_scene2" value="${esc(key)}" style="flex:1">
    <input type="text" class="outfit-val" placeholder="description" value="${esc(val)}" style="flex:2">
    <button class="btn-ghost outfit-del" type="button" style="color:var(--err);padding:0 10px">✕</button>
  </div>`;
}
els.btnCharAddOutfit.addEventListener("click", () => {
  els.charOutfitExtra.insertAdjacentHTML("beforeend", outfitExtraRowHtml("", ""));
  updateAnchorPreview();
});
els.charOutfitExtra.addEventListener("click", (e) => {
  if (e.target.classList.contains("outfit-del")) { e.target.closest(".outfit-extra-row").remove(); updateAnchorPreview(); }
});
els.charOutfitExtra.addEventListener("input", updateAnchorPreview);

function readDraftFromForm() {
  const outfitOverride = { default: els.charOutfitDefault.value.trim() };
  els.charOutfitExtra.querySelectorAll(".outfit-extra-row").forEach(row => {
    const k = row.querySelector(".outfit-key").value.trim();
    const v = row.querySelector(".outfit-val").value.trim();
    if (k && v) outfitOverride[k] = v;
  });
  const productionTypes = [...els.charProdTypesEls()].filter(cb => cb.checked).map(cb => cb.value);
  return {
    id: els.charId.value || charSlug(els.charDisplayName.value),
    displayName: els.charDisplayName.value.trim(),
    characterType: els.charType.value.trim(),
    productionTypes,
    age: els.charAge.value.trim(),
    appearance: els.charAppearance.value.trim(),
    hair: els.charHair.value.trim(),
    tone: els.charTone.value.trim(),
    elevenLabsVoiceId: els.charElevenVoiceId.value.trim(),
    referenceImages: (charDraft && charDraft.referenceImages) || {},
    outfitOverride,
    activeOutfitKey: "default",
    anchorPhrase: els.charAnchorPreview.value.trim(),
    lastUpdated: new Date().toISOString().slice(0, 10)
  };
}
els.charProdTypesEls = () => document.querySelectorAll(".char-prodtype");
/* Anchor phrase is now a directly editable field (was a read-only compiled preview). It still
   auto-fills as the descriptor fields below it change, but only until the user types or pastes
   into it directly — anchorManuallyEdited then blocks further auto-overwrite so a
   hand-written or imported anchor phrase never gets silently clobbered by a later field edit.
   Reset per form open (new character or edit) in resetCharForm(). */
let anchorManuallyEdited = false;
function updateAnchorPreview() {
  if (anchorManuallyEdited) return;
  const draft = readDraftFromForm();
  els.charAnchorPreview.value = buildAnchorPhrase(draft) || "";
}
els.charAnchorPreview.addEventListener("input", () => { anchorManuallyEdited = true; });
["charDisplayName", "charAge", "charAppearance", "charHair", "charTone", "charOutfitDefault"].forEach(id => {
  els[id].addEventListener("input", updateAnchorPreview);
});

function wireCharImageInput(inputEl, prevEl, slot) {
  inputEl.addEventListener("change", async () => {
    const f = inputEl.files[0];
    if (!f) return;
    const dataUri = await fileToDataUri(f);
    if (!charDraft) charDraft = { referenceImages: {} };
    if (!charDraft.referenceImages) charDraft.referenceImages = {};
    charDraft.referenceImages[slot] = dataUri;
    prevEl.src = dataUri;
    prevEl.style.display = "block";
  });
}
wireCharImageInput(els.charImgFront, els.charImgFrontPrev, "front");
wireCharImageInput(els.charImgThreeQuarter, els.charImgThreeQuarterPrev, "threeQuarter");
wireCharImageInput(els.charImgProfile, els.charImgProfilePrev, "profile");

function resetCharForm() {
  charDraft = { referenceImages: {} };
  anchorManuallyEdited = false;
  els.charId.value = "";
  els.charDisplayName.value = ""; els.charType.value = ""; els.charAge.value = "";
  els.charAppearance.value = "";
  els.charHair.value = ""; els.charTone.value = ""; els.charElevenVoiceId.value = "";
  els.charOutfitDefault.value = ""; els.charOutfitExtra.innerHTML = "";
  els.charAnchorPreview.value = "";
  document.querySelectorAll(".char-prodtype").forEach(cb => cb.checked = false);
  [els.charImgFrontPrev, els.charImgThreeQuarterPrev, els.charImgProfilePrev].forEach(p => { p.style.display = "none"; p.src = ""; });
  els.btnCharDelete.style.display = "none";
  updateAnchorPreview();
}
async function openCharForm(id) {
  resetCharForm();
  if (id) {
    const c = await charGet(id);
    if (c) {
      charDraft = c;
      els.charId.value = c.id;
      els.charDisplayName.value = c.displayName || "";
      els.charType.value = c.characterType || "";
      els.charAge.value = c.age || "";
      els.charAppearance.value = c.appearance || "";
      els.charHair.value = c.hair || "";
      els.charTone.value = c.tone || "";
      els.charElevenVoiceId.value = c.elevenLabsVoiceId || "";
      els.charOutfitDefault.value = (c.outfitOverride && c.outfitOverride.default) || "";
      document.querySelectorAll(".char-prodtype").forEach(cb => { cb.checked = (c.productionTypes || []).includes(cb.value); });
      if (c.outfitOverride) {
        Object.keys(c.outfitOverride).filter(k => k !== "default").forEach(k => {
          els.charOutfitExtra.insertAdjacentHTML("beforeend", outfitExtraRowHtml(k, c.outfitOverride[k]));
        });
      }
      if (c.referenceImages) {
        [["front", els.charImgFrontPrev], ["threeQuarter", els.charImgThreeQuarterPrev], ["profile", els.charImgProfilePrev]].forEach(([slot, prev]) => {
          if (c.referenceImages[slot]) { prev.src = c.referenceImages[slot]; prev.style.display = "block"; }
        });
      }
      // An existing saved character already has a considered anchor phrase (hand-written,
      // imported, or a prior auto-compile) — load it verbatim and treat it as authoritative
      // rather than silently recomputing over it the moment resetCharForm's updateAnchorPreview
      // ran above.
      els.charAnchorPreview.value = c.anchorPhrase || buildAnchorPhrase(c) || "";
      anchorManuallyEdited = true;
      els.btnCharDelete.style.display = "inline-block";
    }
  }
  els.charListView.style.display = "none";
  els.charFormView.style.display = "block";
}
els.btnCharNew.addEventListener("click", () => openCharForm(null));
els.btnCharBack.addEventListener("click", () => { els.charFormView.style.display = "none"; els.charListView.style.display = "block"; renderCharList(); });
els.btnCharSave.addEventListener("click", async () => {
  const record = readDraftFromForm();
  if (!record.displayName) { alert("Enter a display name before saving."); return; }
  if (!record.anchorPhrase) record.anchorPhrase = buildAnchorPhrase(record);
  await charPut(record);
  els.charFormView.style.display = "none";
  els.charListView.style.display = "block";
  renderCharList();
  populateSegmentCharPickers();
});
els.btnCharDelete.addEventListener("click", async () => {
  if (!els.charId.value) return;
  if (!confirm("Delete this character? This cannot be undone.")) return;
  await charDelete(els.charId.value);
  els.charFormView.style.display = "none";
  els.charListView.style.display = "block";
  renderCharList();
  populateSegmentCharPickers();
});
els.btnCharLib.addEventListener("click", () => { els.charFormView.style.display = "none"; els.charImportView.style.display = "none"; els.charListView.style.display = "block"; renderCharList(); els.charOverlay.classList.add("open"); });
els.btnCharClose.addEventListener("click", () => els.charOverlay.classList.remove("open"));
els.charOverlay.addEventListener("click", e => { if (e.target === els.charOverlay) els.charOverlay.classList.remove("open"); });

/* ═══════════════ CHARACTER BRIEF IMPORT UI ═══════════════
   "Paste a brief -> review queue -> bulk save" flow described in the task brief. Parsing itself
   (parseCharacterBrief) lives earlier in this file, near buildAnchorPhrase. Nothing here is
   auto-saved: every parsed candidate is shown in a checkbox review list (default all checked)
   and only written to IndexedDB when the user clicks "Import selected". */
let importCandidates = [];
els.btnCharImportOpen.addEventListener("click", () => {
  els.charListView.style.display = "none";
  els.charImportView.style.display = "block";
  els.charImportText.value = "";
  els.charImportPreview.innerHTML = "";
  els.charImportSaveRow.style.display = "none";
  importCandidates = [];
});
els.btnCharImportBack.addEventListener("click", () => {
  els.charImportView.style.display = "none";
  els.charListView.style.display = "block";
});
els.btnCharImportParse.addEventListener("click", () => {
  const text = els.charImportText.value;
  if (!text.trim()) { alert("Paste a character brief first."); return; }
  importCandidates = parseCharacterBrief(text);
  if (!importCandidates.length) {
    els.charImportPreview.innerHTML = '<div class="lib-empty">No characters detected. Expected a block per character starting with "CHARACTER 1: NAME (Type)" followed by numbered sections (Reference Images, Hair, Voice/Tone, etc).</div>';
    els.charImportSaveRow.style.display = "none";
    return;
  }
  els.charImportPreview.innerHTML = importCandidates.map((c, i) => `
    <div class="lib-item" style="align-items:flex-start">
      <input type="checkbox" class="import-pick" data-idx="${i}" checked style="margin-top:6px">
      <div class="meta">
        <div class="t">${esc(c.displayName || "Untitled")}${c.characterType ? " (" + esc(c.characterType) + ")" : ""}</div>
        <div class="d">${esc([c.age, c.hair].filter(Boolean).join(" · ")) || "—"}</div>
        <div class="d">${esc(c.anchorPhrase || buildAnchorPhrase(c) || "")}</div>
      </div>
    </div>`).join("");
  els.charImportSaveRow.style.display = "block";
});
els.btnCharImportSave.addEventListener("click", async () => {
  const checked = [...els.charImportPreview.querySelectorAll(".import-pick:checked")].map(cb => +cb.dataset.idx);
  if (!checked.length) { alert("Select at least one character to import."); return; }
  for (const idx of checked) {
    const c = importCandidates[idx];
    if (!c.anchorPhrase) c.anchorPhrase = buildAnchorPhrase(c);
    await charPut(c);
  }
  els.charImportView.style.display = "none";
  els.charListView.style.display = "block";
  renderCharList();
  populateSegmentCharPickers();
  setStatus("ok", `✓ Imported ${checked.length} character(s) into the Library.`);
});

/* Per-segment character picker — shown under every generated segment that has a Text-to-Image
   Prompt (same condition as the video-generation controls). Auto-preselects any saved character
   whose displayName appears (case-insensitive) in that segment's Type/TTS Script/T2I/I2V text,
   capped at 3 to match the reference-image slot limit Veo and Grok both support — the user can
   freely add/remove selections before generating. Selection is stored directly on the segment's
   window.__segPrompts entry (seg.libraryCharacterIds), read by genClip() below. */
async function populateSegmentCharPickers() {
  const chars = await charGetAll();
  if (!window.__segPrompts) return;
  for (const num of Object.keys(window.__segPrompts)) {
    const wrap = document.getElementById("charPickWrap" + num);
    if (!wrap) continue;
    const seg = window.__segPrompts[num];
    if (!chars.length) { wrap.innerHTML = ""; continue; }
    const haystack = [seg.segType, seg.ttsScript, seg.t2iPrompt, seg.i2vPrompt].filter(Boolean).join(" ").toLowerCase();
    const preselected = seg.libraryCharacterIds || chars.filter(c => c.displayName && haystack.includes(c.displayName.toLowerCase())).map(c => c.id).slice(0, 3);
    seg.libraryCharacterIds = preselected;
    wrap.innerHTML = `<div style="font-size:.72rem;color:var(--muted);margin-top:6px">🎭 Characters in this segment (up to 3, each keeps its own locked reference image + identity):</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
        ${chars.map(c => `<label style="display:flex;align-items:center;gap:4px;font-size:.72rem;cursor:pointer;background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:3px 8px">
          <input type="checkbox" class="char-pick" data-num="${num}" data-id="${c.id}" ${preselected.includes(c.id) ? "checked" : ""} style="width:auto"> ${esc(c.displayName)}
        </label>`).join("")}
      </div>`;
  }
}
window.populateSegmentCharPickers = populateSegmentCharPickers;
els.output.addEventListener("change", (e) => {
  if (!e.target.classList.contains("char-pick")) return;
  const num = e.target.dataset.num;
  const seg = window.__segPrompts && window.__segPrompts[num];
  if (!seg) return;
  const checked = [...document.querySelectorAll(`.char-pick[data-num="${num}"]:checked`)];
  if (checked.length > 3) { e.target.checked = false; alert("Up to 3 characters per segment — matches the reference-image slot limit."); return; }
  seg.libraryCharacterIds = checked.map(cb => cb.dataset.id);
});

window.libDel = function(id){ setLib(getLib().filter(x => x.id !== id)); renderLib(); };
window.libPdf = function(id){
  if (tier !== "pro") { showUpgrade("PDF export is a Pro feature."); return; }
  const item = getLib().find(x => x.id === id); if (item) makePdf(item.title, item.raw, item.meta);
};
els.btnPdf.addEventListener("click", () => { if (!lastRaw) return; if (tier !== "pro") { showUpgrade("PDF export is a Pro feature."); return; } makePdf(titleFor(lastRaw, lastMeta), lastRaw, lastMeta); });
function makePdf(title, raw, meta){
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    const w = window.open("", "_blank");
    w.document.write("<pre style='font:11px Consolas,monospace;white-space:pre-wrap'>" + esc(raw) + "</pre>");
    w.document.close(); w.print(); return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 18, maxW = 210 - margin*2;
  let y = margin;
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  const tLines = doc.splitTextToSize("TAHA Studio AI ScriptForge · " + title, maxW);
  doc.text(tLines, margin, y); y += tLines.length * 6 + 3;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(120);
  doc.text(`${meta && meta.date ? new Date(meta.date).toLocaleString() : ""}${meta && meta.n ? "  ·  " + meta.n + " segments (" + tstamp(segEndTime(meta.n)) + " total)" : ""}  ·  TAHA Production Studio`, margin, y);
  y += 8; doc.setTextColor(30); doc.setFontSize(10);
  const lines = doc.splitTextToSize(raw.replace(/\r/g,""), maxW);
  for (const line of lines) {
    if (y > 280) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", /^###\s*SEGMENT/i.test(line.trim()) ? "bold" : "normal");
    doc.text(line, margin, y);
    y += 5;
  }
  doc.save(title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_").slice(0, 60) + ".pdf");
}
/* ─────────────────────────  MOCK TEST (canned simulation — no API)  ───────────────────────── */
const MOCK_SCRIPT = "Every great video starts with a script, but timing it, shot-listing it, and prepping it for production takes hours. TAHA Studio's Segment Formatter splits any script into perfectly timed ten-second blocks, narration, visuals, motion and audio notes included. From thirty seconds to five minutes, your script is production-ready in one click. Try it free at TAHA Production Studio today.";
const MOCK_RAW = `TECHNICAL SPECS
Script type: Short Advert
Ratio: 16:9
Specs: 1080p · SRT captions · flux-realism for B-roll

---

### SEGMENT 1 | 00:00–00:10

**Type**: Voiceover + B-Roll

**TTS Script**:
> Every great video starts with a script, but timing it, shot-listing it, and prepping it for production takes hours.

**Text-to-Image Prompt**:
> Photorealistic 16:9 shot of a cluttered editor's desk at night, dual monitors glowing with scattered script pages, warm lamp light, shallow depth of field, cinematic documentary grade.

**Image-to-Video Prompt**:
> The camera holds on the glowing monitors as script pages ripple faintly under the desk fan, the editor's hand enters frame to scroll the timeline, cursor blinking on an unfinished script.

**Camera Movement**:
> Slow push-in toward the monitors, fallback Ken Burns zoom on still.

**Lighting**:
> Warm practical lamp light against cool monitor glow, high contrast, moody night interior.

**Mood**:
> Late-night grind, quietly overwhelmed but focused.

**Audio Note**:
> Music bed low (-18 dB), voice clear and forward.

---

### SEGMENT 2 | 00:10–00:20

**Type**: Voiceover + B-Roll

**TTS Script**:
> TAHA Studio's Segment Formatter splits any script into perfectly timed ten-second blocks, narration, visuals, motion, and audio notes included.

**Text-to-Image Prompt**:
> Clean 16:9 screen-capture style view of a dark dashboard interface, glowing blue segment cards appearing one by one, modern tech aesthetic, crisp UI lighting.

**Image-to-Video Prompt**:
> Segment cards animate into place left to right in quick succession, each one populating with labeled fields as a cursor glides between them.

**Camera Movement**:
> Subtle lateral glide, fallback Ken Burns left-to-right.

**Lighting**:
> Even, cool blue UI glow, no harsh shadows, clean tech-product lighting.

**Mood**:
> Confident, efficient, satisfying.

**Audio Note**:
> Keep music steady, no ducking needed.

---

### SEGMENT 3 | 00:20–00:30

**Type**: On-Camera + Brand Close

**TTS Script**:
> From thirty seconds to five minutes, your script is production-ready in one click. Try it free at TAHA Production Studio today.

**Text-to-Image Prompt**:
> Photorealistic 16:9 presenter in a modern studio, soft key light, TAHA Production Studio logo on a wall screen, confident closing smile.

**Image-to-Video Prompt**:
> The presenter delivers the closing line directly to camera, gestures gently toward the logo on the last phrase, holds a warm smile as the frame settles.

**Camera Movement**:
> Static locked shot, end-card fade to logo.

**Lighting**:
> Soft three-point studio key light, clean and bright, brand-safe color balance.

**Mood**:
> Warm, confident, inviting.

**Audio Note**:
> Music swells slightly for close (-14 dB), clean voice tail.`;
els.btnMock.addEventListener("click", () => {
  if (!els.script.value.trim()) { els.script.value = MOCK_SCRIPT; updateWordMeter(); }
  els.btnMock.disabled = true; els.btnFormat.disabled = true;
  setStatus("info", '<span class="spin"></span>Running mock simulation — no API call, no key needed…');
  setTimeout(() => {
    lastRaw = MOCK_RAW;
    lastMeta = { n: 3, ratio: "16:9", type: "Short Advert", date: new Date().toISOString(), mock: true };
    renderOutput(lastRaw);
    els.btnSaveLib.style.display = "inline-block"; els.btnPdf.style.display = "inline-block";
    els.btnSaveLib.textContent = "💾 Save to Library";
    setStatus("ok", "✓ Mock test complete — simulated output, no API used. Every button works: copy blocks, save to Library, download the PDF. Enter your API key to format your own scripts.");
    els.btnMock.disabled = false; els.btnFormat.disabled = false;
  }, 1400);
});
updateLengthUI();


/* ═════════════════════════  ACCOUNTS, GATING & LIBRARY BACKUP (v7)  ═════════════════════════
   Server holds ONLY: email, hashed credential (via auth provider), subscription status,
   license redemption record. Scripts + API key NEVER leave this browser.               */

const FREE_MAX_SEGS = 3, FREE_LIB_CAP = 5;
const PRO_MONTHLY_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_1dj4mZuMYRipiLEHbgot9NjORmxDyf1SOYhc72ryz5k";
const PRO_ANNUAL_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_wcCONu3qcjnaWOHKBvRkKmHyZdrisOFdIQtpm2F0e8c";
const LIFETIME_CHECKOUT_URL = "https://buy.polar.sh/polar_cl_yZ9zCvMx2U09IWhar3iZ4M6sa29MivL8EqeRN4c1Ilv";
let user = null, tier = "free";
let trial = { available: false, active: false, endsAt: null };

const els2 = {};
["btnAccount","authOverlay","btnAuthClose","authTitle","upsell","viewSignedOut","viewSignedIn",
 "authEmail","authPass","btnLogin","btnSignup","btnMagic","btnForgotPw","authStatus","acctInfo","trialBox",
 "btnCheckoutMonthly","btnCheckoutAnnual","btnCheckoutLifetime",
 "licKey","btnRedeem","btnChangePw","changePwBox","newPw","btnSetNewPw",
 "btnSignOut","btnDeleteAcct","deleteConfirm","delPass","btnDeleteFinal",
 "acctStatus","btnLibExport","btnLibImport","libFile","upgradeBox"].forEach(id => els2[id] = $(id));

async function api(path, body){
  try {
    const res = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null; try { data = await res.json(); } catch(e){}
    return { ok: res.ok, status: res.status, data };
  } catch(e) { return { ok: false, status: 0, data: null }; }
}

function setAuthStatus(el, cls, msg){ el.className = "status " + cls; el.innerHTML = msg; }

function applyTier(){
  [...els.segCount.options].forEach(o => {
    const locked = +o.value > FREE_MAX_SEGS && tier !== "pro";
    o.textContent = o.textContent.replace(/ 🔒 Pro$/, "") + (locked ? " 🔒 Pro" : "");
    o.disabled = locked;
  });
  // Pro customers already have full access — the free mock demo is only useful
  // pre-purchase, so hide it once a license is active.
  els.btnMock.style.display = tier === "pro" ? "none" : "";
  if (els.segCount.selectedOptions[0] && els.segCount.selectedOptions[0].disabled) {
    els.segCount.value = String(FREE_MAX_SEGS); updateLengthUI();
  }
  els2.btnAccount.textContent = user ? (tier === "pro" ? (trial.active ? "👤 Account · Trial" : "👤 Account · Pro") : "👤 Account · Free") : "Sign in";
  // Pro subscribers (paid OR on an active trial) no longer need the marketing/about blurb.
  const aboutSection = document.getElementById("aboutSection");
  if (aboutSection) aboutSection.style.display = tier === "pro" ? "none" : "";
  if (user) {
    const planLabel = tier === "pro" ? (trial.active ? `Pro trial (${trialDaysLeft()} day${trialDaysLeft() === 1 ? "" : "s"} left)` : "Pro (active)") : "Free";
    els2.acctInfo.textContent = `Signed in as: ${user.email}\nPlan: ${planLabel}`;
    // Real paid Pro hides the upgrade cards entirely. An active trial keeps them visible —
    // trialers can subscribe early any time instead of waiting for the trial to lapse.
    els2.upgradeBox.style.display = (tier === "pro" && !trial.active) ? "none" : "block";
  }
  renderTrialBox();
}

function trialDaysLeft(){
  if (!trial.endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(trial.endsAt).getTime() - Date.now()) / 86400000));
}

/* Three mutually exclusive states, matching exactly what's visible in the account panel:
   1. Never claimed a trial, not currently paying  -> "CLAIM YOUR TRIAL" button.
   2. Trial claimed and still within its window     -> status line with days remaining.
   3. Trial claimed and its window has passed, still not paying -> "Choose a subscription"
      button that jumps down to the existing plan cards (already visible below it). */
function renderTrialBox(){
  if (!user || (tier === "pro" && !trial.active)) { els2.trialBox.style.display = "none"; els2.trialBox.innerHTML = ""; return; }
  els2.trialBox.style.display = "block";
  if (trial.active) {
    const days = trialDaysLeft();
    els2.trialBox.innerHTML = `<div class="lib-note">🎁 Pro trial active — ${days} day${days === 1 ? "" : "s"} left (ends ${new Date(trial.endsAt).toLocaleString()}). Full Pro access until then — subscribe any time below to keep it going.</div>`;
  } else if (trial.available) {
    els2.trialBox.innerHTML = `<button class="btn-primary" id="btnClaimTrial" style="width:100%">🎁 CLAIM YOUR TRIAL — 7 days full Pro access</button>`;
    document.getElementById("btnClaimTrial").addEventListener("click", claimTrial);
  } else {
    els2.trialBox.innerHTML = `<button class="btn-primary" id="btnChooseSub" style="width:100%">Choose a subscription</button>`;
    document.getElementById("btnChooseSub").addEventListener("click", () => els2.upgradeBox.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

async function claimTrial(){
  setAuthStatus(els2.acctStatus, "info", '<span class="spin"></span>Activating your trial…');
  const r = await api("claim-trial", {});
  if (r.ok) { setAuthStatus(els2.acctStatus, "ok", "✓ 7-day Pro trial activated — enjoy full access!"); await refreshMe(); }
  else setAuthStatus(els2.acctStatus, "err", (r.data && r.data.error) || "Could not start trial.");
}

async function refreshMe(){
  const r = await api("me");
  if (r.ok && r.data && r.data.email) {
    user = r.data;
    tier = (r.data.tier === "pro" && r.data.status === "active") ? "pro" : "free";
    trial = { available: !!r.data.trialAvailable, active: !!r.data.trialActive, endsAt: r.data.trialEndsAt || null };
  } else { user = null; tier = "free"; trial = { available: false, active: false, endsAt: null }; }
  applyTier();
  els2.viewSignedOut.style.display = user ? "none" : "block";
  els2.viewSignedIn.style.display  = user ? "block" : "none";
  els2.authTitle.textContent = user ? "Account" : "Sign in / Create account";
}

function showUpgrade(msg){
  els2.upsell.textContent = "🔒 " + msg + (user ? "" : " Sign in or create a free account, then upgrade.");
  els2.upsell.style.display = "block";
  els2.authOverlay.classList.add("open");
}
function openAccount(){ els2.upsell.style.display = "none"; els2.authOverlay.classList.add("open"); }

els2.btnAccount.addEventListener("click", openAccount);
els2.btnAuthClose.addEventListener("click", () => els2.authOverlay.classList.remove("open"));
els2.authOverlay.addEventListener("click", e => { if (e.target === els2.authOverlay) els2.authOverlay.classList.remove("open"); });

els2.btnLogin.addEventListener("click", async () => {
  setAuthStatus(els2.authStatus, "info", '<span class="spin"></span>Signing in…');
  const r = await api("login", { email: els2.authEmail.value.trim(), password: els2.authPass.value });
  if (r.ok) { setAuthStatus(els2.authStatus, "ok", "✓ Signed in."); els2.authPass.value = ""; await refreshMe(); }
  else setAuthStatus(els2.authStatus, "err", (r.data && r.data.error) || (r.status === 0 ? "Backend unreachable — accounts need the tahastudiolabs.com deployment." : "Sign-in failed. Check email and password."));
});
els2.btnSignup.addEventListener("click", async () => {
  setAuthStatus(els2.authStatus, "info", '<span class="spin"></span>Creating account…');
  const r = await api("signup", { email: els2.authEmail.value.trim(), password: els2.authPass.value });
  /* No email step at all: the backend confirms the address and signs the user in with the
     password they just chose in the same request. autoLogin:false only happens in the rare
     case that couldn't complete (network hiccup etc.) — fall back to asking them to sign in. */
  if (r.ok && r.data && r.data.autoLogin) { setAuthStatus(els2.authStatus, "ok", "✓ Account created and signed in."); els2.authPass.value = ""; await refreshMe(); }
  else if (r.ok) { setAuthStatus(els2.authStatus, "ok", "✓ Account created — sign in with your new password."); els2.authPass.value = ""; }
  else setAuthStatus(els2.authStatus, "err", (r.data && r.data.error) || "Sign-up failed.");
});
els2.btnMagic.addEventListener("click", async () => {
  setAuthStatus(els2.authStatus, "info", '<span class="spin"></span>Sending link…');
  const r = await api("magic", { email: els2.authEmail.value.trim() });
  if (r.ok) setAuthStatus(els2.authStatus, "ok", "✓ Check your inbox for a one-click sign-in link.");
  else setAuthStatus(els2.authStatus, "err", (r.data && r.data.error) || "Could not send link.");
});
els2.btnForgotPw.addEventListener("click", async () => {
  const email = els2.authEmail.value.trim();
  if (!email) { setAuthStatus(els2.authStatus, "err", "Enter your email above first."); return; }
  setAuthStatus(els2.authStatus, "info", '<span class="spin"></span>Sending reset link…');
  const r = await api("forgot-password", { email });
  setAuthStatus(els2.authStatus, r.ok ? "ok" : "err", r.ok ? "✓ If that email has an account, a password reset link is on its way. This is a one-time link — after you use it you'll be able to sign in with your password normally from then on." : ((r.data && r.data.error) || "Could not send reset link."));
});
els2.btnChangePw.addEventListener("click", () => {
  els2.changePwBox.style.display = els2.changePwBox.style.display === "none" ? "block" : "none";
});
els2.btnSetNewPw.addEventListener("click", async () => {
  const pw = els2.newPw.value;
  if (pw.length < 8) { setAuthStatus(els2.acctStatus, "err", "Password must be at least 8 characters."); return; }
  setAuthStatus(els2.acctStatus, "info", '<span class="spin"></span>Updating password…');
  const r = await api("update-password", { password: pw });
  if (r.ok) { setAuthStatus(els2.acctStatus, "ok", "✓ Password updated. Use it to sign in directly next time."); els2.newPw.value = ""; els2.changePwBox.style.display = "none"; }
  else setAuthStatus(els2.acctStatus, "err", (r.data && r.data.error) || "Could not update password.");
});
els2.btnSignOut.addEventListener("click", async () => { await api("logout", {}); await refreshMe(); });

els2.btnCheckoutMonthly.addEventListener("click", () => window.open(PRO_MONTHLY_CHECKOUT_URL, "_blank", "noopener"));
els2.btnCheckoutAnnual.addEventListener("click", () => window.open(PRO_ANNUAL_CHECKOUT_URL, "_blank", "noopener"));
els2.btnCheckoutLifetime.addEventListener("click", () => window.open(LIFETIME_CHECKOUT_URL, "_blank", "noopener"));
els2.btnRedeem.addEventListener("click", async () => {
  setAuthStatus(els2.acctStatus, "info", '<span class="spin"></span>Redeeming license…');
  const r = await api("redeem", { license_key: els2.licKey.value.trim() });
  if (r.ok) { setAuthStatus(els2.acctStatus, "ok", "✓ License redeemed — Pro unlocked on this account."); await refreshMe(); }
  else setAuthStatus(els2.acctStatus, "err", (r.data && r.data.error) || "Redemption failed.");
});

els2.btnDeleteAcct.addEventListener("click", () => { els2.deleteConfirm.style.display = "block"; });
els2.btnDeleteFinal.addEventListener("click", async () => {
  setAuthStatus(els2.acctStatus, "info", '<span class="spin"></span>Deleting account…');
  const r = await api("delete-account", { password: els2.delPass.value });
  if (r.ok) { setAuthStatus(els2.acctStatus, "ok", "✓ Account and all stored records deleted. Your local Library remains on this device."); user = null; tier = "free"; applyTier(); await refreshMe(); }
  else setAuthStatus(els2.acctStatus, "err", (r.data && r.data.error) || "Deletion failed — check your password.");
});

/* auth callback: handles BOTH magic-link sign-in and password-recovery links, since Supabase
   returns tokens in the URL fragment the same way for either — exchange them for httpOnly
   cookies, never persist. type=recovery means this was a "forgot password" link specifically:
   once signed in, open the account panel with the change-password box already expanded so the
   one-time link ends in a permanent password, not a routine to repeat. */
(async function authCallback(){
  const h = new URLSearchParams(location.hash.slice(1));
  let isRecovery = false;
  if (h.get("access_token") && h.get("refresh_token")) {
    isRecovery = h.get("type") === "recovery";
    history.replaceState(null, "", location.pathname + location.search);
    await api("session-from-token", { access_token: h.get("access_token"), refresh_token: h.get("refresh_token") });
  }
  await refreshMe();
  if (isRecovery && user) {
    openAccount();
    els2.changePwBox.style.display = "block";
    setAuthStatus(els2.acctStatus, "info", "Set a new password below to finish resetting your login.");
  }
})();

/* library export / import — manual backup path, no cloud copy exists */
els2.btnLibExport.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "TAHA_ScriptForge_Library", version: 1, exported: new Date().toISOString(), items: getLib() }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "scriptforge-library-" + new Date().toISOString().slice(0,10) + ".json";
  a.click(); URL.revokeObjectURL(a.href);
});
els2.btnLibImport.addEventListener("click", () => els2.libFile.click());
els2.libFile.addEventListener("change", () => {
  const f = els2.libFile.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      const items = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(items)) throw new Error("bad format");
      const lib = getLib(); const have = new Set(lib.map(x => x.id)); let added = 0;
      for (const it of items) if (it && it.id && it.raw && !have.has(it.id)) { lib.push(it); added++; }
      lib.sort((a,b) => b.id - a.id);
      if (tier !== "pro" && lib.length > FREE_LIB_CAP && added > 0) { showUpgrade("Import would exceed the free Library limit of " + FREE_LIB_CAP + " scripts."); els2.libFile.value = ""; return; }
      setLib(lib); renderLib();
      alert(added + " script(s) imported.");
    } catch(e) { alert("Could not import — not a valid ScriptForge library file."); }
    els2.libFile.value = "";
  };
  rd.readAsText(f);
});

/* ═════════════════════════  VIDEO GENERATION (Veo 3.1 / Grok Imagine / HeyGen)  ═════════════════════════
   Calls our own /api/video-start, /api/video-poll, /api/video-download relays — never the
   provider directly — using whichever of your own keys you entered in "5 · Video Generation".
   Ported from the standalone local pilot that validated all three providers; the only change
   is that every provider call now goes through our server instead of straight from the browser,
   for the same reason the Anthropic "Format" call does (real customers' ad blockers / antivirus
   can silently block a direct third-party call — confirmed behavior earlier in this product). */
async function videoApi(path, body) {
  const res = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function vidSetStatus(num, cls, msg) {
  const el = $("vidStatus" + num);
  if (!el) return;
  el.className = "status " + cls;
  el.innerHTML = msg;
}

/* Combines the 5-field B-roll model (Text-to-Image / Image-to-Video / Camera Movement /
   Lighting / Mood) into one cohesive visual description for whichever video generator ends up
   receiving it. Each field is kept as its own clearly labeled clause rather than mashed together
   unlabeled, so the video generator can tell the still composition, the motion, the camera work,
   the lighting, and the mood apart, per the user's requirement that it "fully understand the
   role it should play." */
function buildVisualDescription(seg) {
  const parts = [];
  if (seg.t2iPrompt) parts.push(seg.t2iPrompt);
  if (seg.i2vPrompt) parts.push(seg.i2vPrompt);
  if (seg.camera) parts.push("Camera: " + seg.camera);
  if (seg.lighting) parts.push("Lighting: " + seg.lighting);
  if (seg.mood) parts.push("Mood: " + seg.mood);
  return parts.join(". ");
}

window.genClip = async function (num, btn) {
  const seg = window.__segPrompts && window.__segPrompts[num];
  if (!seg) { vidSetStatus(num, "err", "No segment data found."); return; }

  /* Character Library (Phase 1) — if this segment has one or more saved characters selected
     (see populateSegmentCharPickers() above), their reference images and compiled anchor
     phrases take priority over both frame-chaining and any manually-attached reference images
     for Veo/Grok, and get named into the prompt for all three providers. This is the actual
     fix for cross-segment identity drift (frame-chaining alone only carries forward whatever
     the previous clip happened to render, with no anchor to what a character is actually
     supposed to look like). */
  const libChars = (seg.libraryCharacterIds && seg.libraryCharacterIds.length)
    ? (await Promise.all(seg.libraryCharacterIds.map(charGet))).filter(Boolean)
    : [];

  const provider = $("vidGen" + num).value;
  const providerMeta = VIDEO_PROVIDERS[provider];
  const apiKey = els[providerMeta.keyEl].value.trim();
  if (!apiKey) { vidSetStatus(num, "err", `Enter your ${provider === "veo" ? "Gemini" : provider === "grok" ? "xAI" : "HeyGen"} API key in the "5 · Video Generation" section first.`); return; }

  /* Duration: only Grok Imagine’s API actually accepts a variable duration (1-15s, confirmed
     via docs.x.ai/developers/model-capabilities/video/generation). Veo 3.1 generates fixed
     8-second clips per call (ai.google.dev/gemini-api/docs/veo) — sending it anything else
     isn’t supported by this integration, so it’s ignored. HeyGen’s /v3/video-agents has no
     formal duration field at all (confirmed via its OpenAPI schema) — "Duration: ~Ns" in the
     prompt is only a hint to its storyboard planner, not an enforced parameter. */
  const durInput = document.getElementById("vidDur" + num);
  const requestedDuration = Math.min(15, Math.max(1, Number(durInput?.value) || 15));

  /* Round 1 fix (routing TTS Script to HeyGen instead of the Visual Prompt) was confirmed
     insufficient by real-world testing: HeyGen still produced no sound, and Grok produced
     background music but never spoke the dialogue. Verified against each provider's actual
     API docs (not guessed):
     - Veo 3.1 (ai.google.dev/gemini-api/docs/veo): natively generates dialogue + SFX +
       ambience in ONE call, but only if the prompt explicitly writes speech in quotes, e.g.
       `A character says: "..."` — plain visual description alone renders silent/ambient-only.
     - Grok Imagine (docs.x.ai .../video/generation): the REST body is just
       {model, prompt, duration} — there is no separate dialogue field. Grok DOES support
       short embedded dialogue with lip-sync (per xAI's own partner-quote marketing), but only
       if the spoken line is written into the prompt text itself. Our old code sent Grok only
       seg.visualPrompt — literally never gave it any words — which fully explains "music but
       no dialogue": Grok had nothing to say because we never sent it anything to say.
     - HeyGen Video Agent (developers.heygen.com/reference/create-video-agent-session): the
       body has no dedicated script field either — a single free-text `prompt` (1–10000 chars)
       that an LLM storyboard planner freely interprets, deciding on its own whether to include
       an avatar and whether it speaks. avatar_id/voice_id default to null (auto-picked). HeyGen's
       own prompting guide's "Scene-by-Scene Prompting: Maximum Control" section recommends a
       labeled `Scene / Visual / VO/Script: "..." / Duration` structure specifically to force
       verbatim spoken narration — a bare unlabeled string (the round-1 fix) doesn't clearly
       signal "this must be spoken by an on-camera presenter," so the planner could reasonably
       render silent B-roll instead, which matches what was seen.

     Round 2 fix (appending a bare `. Audio: ${seg.audioNote}` tag to the end of the prompt for
     all three providers) shipped, but real-world testing (user-reported, every generation)
     showed the sound-design cue itself — bells, ambient swells, music fades, etc. — was still
     being dropped even though dialogue now worked correctly. Root cause is the same pattern as
     round 1: a short, unlabeled, non-imperative tag buried at the very end of an already-long
     prompt gets deprioritized against the much more forcefully worded visual/dialogue
     instructions right next to it ("must speak... verbatim, aloud" vs. a bare "Audio: X").
     ROUND 3 FIX: give the audio note the same treatment dialogue already gets — labeled,
     quoted, and explicitly imperative ("must be present", "do not omit"), not a passive tag.
     buildAudioDirective() below is shared across all three providers so this only needs to be
     fixed in one place. ROLLBACK: revert to a bare `Audio: ${seg.audioNote}` append by removing
     the buildAudioDirective() calls below and restoring the tag inline — no other code depends
     on this function. */
  /* ROUND 4 FIX: takes the whole segment now, not just the note string, and NEVER returns "" —
     the three call sites below used to skip this entirely (`seg.audioNote ? ... : ""`) whenever
     a segment had no Audio Note, which meant a video generator got zero ambience guidance and
     could render a scene as acoustically dead silent. User-reported: a rain-soaked market scene
     and a forest scene both came back with no environmental sound at all. No real-world location
     is ever silent, so this always emits something: the formatter-written Audio Note when present
     (buildSystemPrompt now requires every segment to have one), or a scene-derived fallback built
     from the segment's own Text-to-Image Prompt/Type when it's missing (e.g. a manually-edited or
     older pre-fix segment), rather than silently contributing nothing. */
  function buildAudioDirective(seg) {
    const note = seg && seg.audioNote;
    if (note) {
      return `Sound design — the finished audio track must clearly include the following, layered in with any dialogue and not replaced by generic ambience: "${note}". Do not omit these specific sound cues. No real-world location is ever acoustically silent, so this ambience must be audibly present under any dialogue or music, never dropped in favor of silence.`;
    }
    const scene = ((seg && (seg.t2iPrompt || seg.segType)) || "").replace(/\s+/g, " ").trim().slice(0, 140);
    return `Sound design — no Audio Note was specified for this segment, but no real-world location is ever acoustically silent. Include ambient environmental sound appropriate to this scene's actual setting${scene ? ` ("${scene}")` : ""}: wind, birdsong, or nature sounds for outdoor/forest settings, traffic and city hum for urban settings, crowd bustle for markets or crowds, quiet room tone for interiors. Layer this under any dialogue or music, do not render the scene as silent.`;
  }

  /* User-reported bug (real production test, Coca-Cola advert): Veo/Grok were always told "a
     character on screen says X" regardless of segment Type, even for Voiceover + B-Roll shots
     that may show no person at all (a statue, a street, a product on its own), which is a
     mismatched instruction the video generator has to silently reconcile however it can. Also
     surfaced a second, related issue: an On-Camera segment's TTS Script got treated as narration
     played over unrelated action (a woman drinking, never speaking) instead of a line she
     actually delivers to camera. This mirrors the same fix now in buildSystemPrompt()'s rule 19
     at the generation layer: On-Camera/On-Camera + Brand Close gets an explicit "speaks aloud,
     directly to camera" instruction; Voiceover + B-Roll gets "narration plays over this shot"
     instead, since there may be no one on screen to lip-sync to. */
  function dialogueDirective(seg) {
    if (!seg || !seg.ttsScript) return "";
    const isVO = ((seg.segType || "").toLowerCase()).includes("voiceover");
    return isVO
      ? `Voiceover narration plays over this shot, not lip-synced to anyone on screen: "${seg.ttsScript}"`
      : `The on-camera subject speaks this line aloud, directly to camera, mouth movement matching the words: "${seg.ttsScript}"`;
  }

  let prompt;
  if (provider === "heygen") {
    if (!seg.ttsScript) { vidSetStatus(num, "err", "No TTS Script found for this segment — HeyGen needs the spoken script text to generate voice."); return; }
    prompt = `Scene: ${seg.segType || "On-camera presenter"}\n`
      + `Visual: ${buildVisualDescription(seg) || "A presenter speaking directly to camera"}\n`
      + `VO/Script: "${seg.ttsScript}"\n`
      + `Instruction: this is a talking-presenter video, not silent B-roll — an on-camera avatar must speak the VO/Script line above verbatim, aloud, in a natural human voice.`
      + (libChars.length ? `\nCharacter(s) (Character Library — keep exactly as described, do not invent a different appearance): ${libChars.map(c => `${c.displayName || "character"} — ${c.anchorPhrase || buildAnchorPhrase(c)}`).join("; ")}` : "")
      + `\nAudio Instruction: ${buildAudioDirective(seg)}`
      + `\nDuration: ~${requestedDuration} seconds`;
  } else if (provider === "grok") {
    if (!seg.t2iPrompt) { vidSetStatus(num, "err", "No visual prompt found for this segment."); return; }
    let p = buildVisualDescription(seg);
    const dd = dialogueDirective(seg);
    if (dd) p += `. ${dd}`;
    p += `. ${buildAudioDirective(seg)}`;
    prompt = p;
  } else {
    // Veo 3.1 — natively supports dialogue/SFX/ambience in the same prompt (per Google's own
    // prompting guide), using quotes for speech, so pass TTS Script/Audio Note through too.
    if (!seg.t2iPrompt) { vidSetStatus(num, "err", "No visual prompt found for this segment."); return; }
    let p = buildVisualDescription(seg);
    const dd = dialogueDirective(seg);
    if (dd) p += `. ${dd}`;
    p += `. ${buildAudioDirective(seg)}`;
    prompt = p;
  }

  btn.disabled = true;
  $("vidResult" + num).innerHTML = "";
  vidSetStatus(num, "info", '<span class="spin"></span>Submitting…');

  try {
    const chainCheckbox = $("chainUse" + num);
    /* Library characters (if any are selected for this segment) take priority over both
       frame-chaining and manually-attached reference images — mixing an identity-locked
       character photo with a frame-chained "whatever rendered last time" photo in the same
       request would give the model two competing ideas of what the same reference slot should
       show. useChain is forced off whenever libChars is non-empty. */
    const useChain = !!(chainFrames[num] && chainCheckbox && chainCheckbox.checked) && !libChars.length;
    let refFiles;
    if (libChars.length) {
      refFiles = (await Promise.all(libChars.slice(0, 3).map(async c => {
        const img = c.referenceImages && (c.referenceImages.front || c.referenceImages.threeQuarter || c.referenceImages.profile);
        if (!img) return null;
        try {
          const blob = await (await fetch(img)).blob();
          return new File([blob], `${c.id}-ref.png`, { type: blob.type || "image/png" });
        } catch (e) { return null; }
      }))).filter(Boolean);
    } else {
      const slot1 = useChain ? new File([chainFrames[num]], `segment${num}-chained-ref.png`, { type: "image/png" }) : els.refImg1?.files?.[0];
      refFiles = [slot1, els.refImg2?.files?.[0], els.refImg3?.files?.[0]].filter(Boolean);
    }
    const aspectRatio = els.vidAspectRatio?.value || "16:9";
    const resolutionSel = els.vidResolution?.value || "720p";

    /* Aspect ratio / resolution — the standalone pilot had these as real controls (Veo’s
       predictLongRunning API takes aspectRatio/resolution/durationSeconds directly), but the
       fusion never exposed them: genClip always sent the server-side defaults (16:9, 720p,
       durationSeconds:8) no matter what. Restoring parity with the pilot, including its
       duration-forcing rule — Veo only accepts 4/6/8-second clips, and Google forces 8s
       whenever resolution is 1080p/4k or a reference image is attached. */
    const veoForce8 = resolutionSel === "1080p" || resolutionSel === "4k" || refFiles.length > 0;
    let veoDuration = requestedDuration;
    if (veoForce8) veoDuration = 8;
    else veoDuration = [4, 6, 8].reduce((best, v) => Math.abs(v - veoDuration) < Math.abs(best - veoDuration) ? v : best);

    const params = {
      aspectRatio,
      // Grok’s base "grok-imagine-video" model doesn’t support 1080p/4k (that tier is 1.5-only,
      // and only for image-to-video) — always send 720p for Grok regardless of the Resolution
      // dropdown, rather than let a request with an unsupported resolution fail.
      resolution: provider === "grok" ? "720p" : resolutionSel,
      durationSeconds: veoDuration,
      duration: provider === "grok" ? requestedDuration : 8,
      // HeyGen has no resolution field, only orientation (landscape/portrait) — derive it from
      // the same aspect-ratio control so all three providers respect one shared setting.
      orientation: aspectRatio === "9:16" ? "portrait" : "landscape"
    };

    /* Reference images used to be encoded ONLY when provider === "veo" — selecting Grok skipped
       this whole block silently (no error shown), so Grok always generated from text alone and
       invented its own visuals instead of using the attached image. Grok Imagine has its own
       documented reference-to-video mode (docs.x.ai/.../video/reference-to-video), so it now
       gets the same images too, just encoded in the shape Grok's API actually expects.

       ROLE ASSIGNMENT: real-world testing showed the same reference image attached in all 3
       slots still produced a completely different person on screen. Root-caused two distinct
       issues, verified against each provider's actual docs (not guessed):
       - Veo (ai.google.dev/gemini-api/docs/video#reference-images): every reference image
         object requires a "referenceType": "asset" field — this relay was never sending it at
         all, an outright malformed request, not a prompt-wording problem.
       - Neither provider has a per-image "this one is the main character" flag in the API
         itself. Google's own reference-image examples tie images to roles purely through prose
         in the prompt (describing "a woman... wearing X... and Y" so each asset maps to a
         described element), while Grok's own docs use inline <IMAGE_1>/<IMAGE_2> tags for the
         same purpose. So slot 1 is now explicitly called out in the prompt as the required
         on-camera narrator — via Grok's documented <IMAGE_n> tags for Grok, and via plain
         descriptive instruction for Veo (which has no numbered-tag convention) — and slots 2-3
         are described as supporting participants, matching how each provider actually expects
         multi-image intent to be communicated.

       MULTI-CHARACTER FIX (real-world testing, user-reported): the wording above assumed slot 1
       always shows exactly ONE person ("The person shown... keep their exact face"). That's true
       for a manually-uploaded headshot, but slot 1 can also be a frame-chained image (see
       extractLastFrame() above) — the actual last frame of a multi-character scene, e.g. two
       people in frame together. Telling the model "the person... their exact face" about an
       image that shows two people is a direct mismatch: it gives the model no instruction to
       preserve the second person at all, which plausibly explains why chained multi-character
       scenes were coming back with different people each segment even though single-character
       chained scenes worked. Fixed to describe "every person visible" rather than assuming a
       headcount of one, so it correctly covers both the single-headshot case and the
       chained-multi-person-frame case with the same wording. */
    /* NAMED-CHARACTER ROLE NOTE (Character Library): when libChars is populated, each reference
       image slot maps to one specific saved character rather than an anonymous "person" — the
       prompt names them and states their compiled anchor phrase (age/hair/outfit/tone) per slot,
       so the model isn't just shown a face, it's told whose face it is and what's supposed to
       stay consistent about them. This is the direct multi-character fix: two named women can
       each get their own tagged slot instead of sharing one generic "the person(s)" instruction. */
    function buildCharacterRoleNote(chars, providerName) {
      const lines = chars.map((c, i) => {
        const tag = providerName === "grok" ? `<IMAGE_${i + 1}>` : `Reference image ${i + 1}`;
        const anchor = c.anchorPhrase || buildAnchorPhrase(c);
        return `${tag} shows ${c.displayName || "a character"}${anchor ? ` — ${anchor}` : ""}. This exact person must appear in the scene, keeping their face and identity recognizable and distinct from any other character present.`;
      });
      return lines.join(" ") + (chars.length > 1 ? " All named characters above must appear together in this scene exactly as described, each one distinct from the others — do not merge, swap, or invent different people." : "");
    }
    if (provider === "veo" || provider === "grok") {
      if (refFiles.length) {
        vidSetStatus(num, "info", '<span class="spin"></span>Encoding reference image(s)…');
        if (provider === "veo") {
          const encoded = await Promise.all(refFiles.map(fileToBase64));
          params.referenceImages = encoded.map(img => ({ image: img, referenceType: "asset" }));
          prompt = (libChars.length
            ? buildCharacterRoleNote(libChars, "veo") + " "
            : (refFiles.length > 1
              ? "The first reference image shows the required on-camera character(s) for this scene — whether it shows one person or several, every one of them must keep their exact face and identity recognizable and distinct from the others, while they move naturally, act, and interact with their environment throughout the clip, speaking the dialogue below aloud. Any other reference images show additional supporting participants or objects that may also appear, but must not replace anyone already shown in the first reference image. "
              : "The reference image shows the required on-camera character(s) for this scene — whether it shows one person or several, every one of them must keep their exact face and identity recognizable and distinct from the others, while they move naturally, act, and interact with their environment throughout the clip, speaking the dialogue below aloud. "
            )
          ) + prompt;
        } else {
          const dataUris = await Promise.all(refFiles.map(fileToDataUri));
          params.referenceImages = dataUris.map(url => ({ url }));
          // Grok's reference-to-video mode caps duration at 10s whenever reference images are
          // attached (confirmed in its docs) — clamp down rather than let the request fail.
          if (params.duration > 10) {
            params.duration = 10;
            vidSetStatus(num, "info", '<span class="spin"></span>Reference image attached — Grok caps clips with a reference image at 10s, adjusting…');
          }
          let roleNote;
          if (libChars.length) {
            roleNote = buildCharacterRoleNote(libChars, "grok");
          } else {
            roleNote = "<IMAGE_1> shows the required on-camera character(s) for this scene — whether it shows one person or several, every one of them must keep their exact face and identity recognizable and distinct from the others, while they move naturally, act, and interact with their environment throughout the clip, speaking the dialogue below aloud.";
            if (refFiles.length > 1) roleNote += ` <IMAGE_2>${refFiles.length > 2 ? " and <IMAGE_3>" : ""} show additional supporting participants or objects that may also appear in the shot, but must not replace anyone already shown in <IMAGE_1>.`;
          }
          prompt = roleNote + " " + prompt;
        }
        vidSetStatus(num, "info", '<span class="spin"></span>Submitting…');
      }
    }
    /* --- Global prompt safety rules (forced on every generated visual prompt, regardless
   of provider) ---
   FIRST-FRAME ANCHOR: every prompt must open with this exact, immutable instruction so
   the model treats the reference composition as locked and only animates the specified
   motion, never reinventing subject/background/product design.
   GENERATOR-SPECIFIC SEPARATION BLUEPRINTS: a tail-end command matched to how each
   target generator actually behaves (static talking head vs. physical object
   interaction), appended after everything else so it's always the last instruction
   the model sees. */
const FIRST_FRAME_ANCHOR = "This reference composition anchors the character's identity and the setting only — their face and the environment must stay recognizable. This is a full continuous video, NOT a still photo: the character must move naturally, gesture, walk, and actively interact with objects and their environment throughout the clip, and must audibly speak every word of the dialogue below on camera with lip-synced, natural delivery. Never render a static, frozen, motionless, or silent shot.";
prompt = FIRST_FRAME_ANCHOR + " " + prompt;

if (provider === "heygen") {
  prompt += " [The human actor moves naturally, gestures, and interacts with their environment while speaking the synced script audio directly to the camera with realistic facial expressions and lip-sync. Only static props/products in frame must remain unwarped and structurally stable — the character and the overall scene must show continuous natural motion, not a frozen shot.]";
} else if (provider === "veo") {
  prompt += " [This is a dynamic video: the character performs continuous natural motion — walking, gesturing, or interacting with the environment — while speaking every line of dialogue below aloud with realistic lip-sync and facial expression. Maintain their identity, branding, and logo clarity while doing so, but do not produce a static, frozen, or silent shot.]";
}

const elevenKey = els.elevenLabsKey?.value.trim();
/* HARDCODED NARRATION VOICE: per explicit request, narration audio always uses this exact
ElevenLabs voice ("mY VOICE"), regardless of whatever is selected in the Voice dropdown above
(that dropdown still only controls the text written into the script's TECHNICAL SPECS block).
This guarantees the downloaded/HeyGen-fed narration audio never silently mismatches the
reference voice that was actually validated end-to-end. To change the fixed voice later,
update this ID (elevenlabs.io → Voices → the voice's settings show its Voice ID). */
const elevenVoice = "y5e1PUCrX9XvTExckwSl";
let elevenAudioBlob = null;
if (elevenKey && elevenVoice && seg.ttsScript) {
try {
vidSetStatus(num, "info", '<span class="spin"></span>Generating narration audio (ElevenLabs)…');
elevenAudioBlob = await fetchElevenTTS(elevenVoice, elevenKey, seg.ttsScript);
if (provider === "heygen" && els.heygenAvatarId?.value.trim()) {
vidSetStatus(num, "info", '<span class="spin"></span>Uploading narration to HeyGen…');
const base64 = await blobToBase64(elevenAudioBlob);
const upRes = await videoApi("heygen-upload-asset", { apiKey, base64, mimeType: elevenAudioBlob.type || "audio/mpeg" });
if (!upRes.ok) throw new Error(upRes.data?.error?.message || `HTTP ${upRes.status}`);
params.audioAssetId = upRes.data.assetId;
params.avatarId = els.heygenAvatarId.value.trim();
}
vidSetStatus(num, "info", '<span class="spin"></span>Submitting…');
} catch (e) {
vidSetStatus(num, "err", "ElevenLabs step failed: " + e.message + " — continuing without it.");
elevenAudioBlob = null;
delete params.audioAssetId;
delete params.avatarId;
await new Promise(r => setTimeout(r, 1200));
vidSetStatus(num, "info", '<span class="spin"></span>Submitting…');
}
}
const startRes = await videoApi("video-start", { provider, apiKey, prompt, params });
    if (!startRes.ok) throw new Error(startRes.data?.error?.message || `HTTP ${startRes.status}`);
    let jobRef = startRes.data.jobRef;

    const maxAttempts = 225, pollInterval = 4000;
    let uri = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, pollInterval));
      vidSetStatus(num, "info", `<span class="spin"></span>Rendering… (attempt ${attempt}/${maxAttempts})`);
      const pollRes = await videoApi("video-poll", { provider, apiKey, jobRef });
      if (!pollRes.ok) throw new Error(pollRes.data?.error?.message || `HTTP ${pollRes.status}`);
      if (pollRes.data.jobRef) jobRef = pollRes.data.jobRef;
      if (pollRes.data.done) { uri = pollRes.data.uri; break; }
    }
    if (!uri) throw new Error("Timed out waiting for the clip after ~15 minutes.");

    vidSetStatus(num, "info", '<span class="spin"></span>Fetching clip…');
    const dlRes = await fetch("/api/video-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, uri })
    });
    if (!dlRes.ok) {
      const errData = await dlRes.json().catch(() => null);
      throw new Error(errData?.error?.message || `Download failed: HTTP ${dlRes.status}`);
    }
    const blob = await dlRes.blob();
    const blobUrl = URL.createObjectURL(blob);
    let narrationHtml = "";
if (elevenAudioBlob && (provider === "veo" || provider === "grok")) {
const narrationUrl = URL.createObjectURL(elevenAudioBlob);
narrationHtml = `<div style="margin-top:6px"><a href="${narrationUrl}" download="segment-${num}-narration.mp3" style="color:var(--accent2)">🔊 Download narration audio (ElevenLabs) — mux onto the clip above in your editor</a></div>`;
}
$("vidResult" + num).innerHTML = `
<video controls src="${blobUrl}" style="max-width:100%;border-radius:8px"></video>
<div style="margin-top:6px"><a href="${blobUrl}" download="segment-${num}-clip.mp4" style="color:var(--accent2)">⬇ Download this clip</a></div>
${narrationHtml}`;
if (provider === "veo" || provider === "grok") {
try {
const frameBlob = await extractLastFrame(blobUrl);
if (frameBlob) { chainFrames[String(Number(num) + 1)] = frameBlob; showChainOption(String(Number(num) + 1)); }
} catch (e) {}
}
vidSetStatus(num, "ok", "✓ Done.");
  } catch (err) {
    vidSetStatus(num, "err", "Error: " + err.message);
  } finally {
    btn.disabled = false;
  }
};
