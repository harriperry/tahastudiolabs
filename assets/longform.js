/* ═══════════════════════════════════════════════════════════════════════════
   SCRIPTFORGE — LONG-FORM PROJECT ORCHESTRATION & CONTINUITY ENGINE
   ═══════════════════════════════════════════════════════════════════════════
   ADDITIVE ONLY, same rollback contract as FEATURE_SMART_RECOMMEND and the
   Character Library elsewhere in this app: this file, the "🎬 Long-Form
   Project" button, and the #longformOverlay markup in index.html are the only
   three things that reference this feature. Nothing in app.js is modified.
   Deleting this <script> tag, the button, and the overlay markup removes the
   feature with zero effect on Quick Generation, the Character Library, the
   Script Library, or video generation.

   WHY A SEPARATE FILE INSTEAD OF EDITING app.js:
   app.js already defines everything this feature needs as plain top-level
   `const`/`function` declarations in a classic (non-module) script — that
   means a second classic <script> tag loaded after app.js shares the same
   global scope and can reference them directly by name. So this file reuses,
   rather than duplicates:
     - tstamp(), segStartTime(), segEndTime(), segDuration()   (timing model)
     - computeMaxTokens(), PROVIDER_MAX_OUTPUT_TOKENS           (token budgeting)
     - PROVIDER_KEY_FIELD, PROVIDER_MODEL_FIELD, els            (existing key/model inputs)
     - MODEL_CAPABILITIES, scoreModel(), PRODUCTION_TYPE_WEIGHTS (model advisory)
     - renderOutput(), esc(), pick()                            (segment rendering)
     - getLib(), setLib(), titleFor(), lastRaw, lastMeta        (Script Library)
   This is the actual "orchestration layer around the existing generation
   capability" the spec asked for — it calls the same /api/format relay, the
   same per-segment output template, and the same renderer as Quick Generation,
   it just calls /api/format more than once and keeps track of what happened
   between calls.

   FUNDAMENTAL RULE THIS FILE FOLLOWS: ScriptForge (this code) owns the
   project's structure — how many units, what time range each covers, what
   happened in each one. The AI model only ever fills in *content* inside a
   structure this code already decided. The model is never asked to remember
   the whole production across calls; the Continuity State object is. */

(function () {
  "use strict";

  /* ═══════════════ 0. SMALL DEFENSIVE SHIMS ═══════════════
     High confidence these globals exist (read directly from app.js source
     during the architecture audit), but if a future refactor renames one,
     fail loud in the console instead of silently breaking mid-generation. */
  function requireGlobal(name) {
    if (typeof window[name] === "undefined" && typeof eval("typeof " + name) === "undefined") {
      console.error(`[longform.js] Expected app.js to define "${name}" — long-form projects will not work until this is fixed. See the header comment in longform.js.`);
    }
  }
  ["tstamp", "segStartTime", "segEndTime", "segDuration", "computeMaxTokens",
   "renderOutput", "esc", "getLib", "setLib", "titleFor"].forEach(requireGlobal);

  const $ = id => document.getElementById(id);

  /* ═══════════════ 1. PROJECT PERSISTENCE (IndexedDB) ═══════════════
     Same pattern as the Character Library's charDbOpen()/charGetAll() in
     app.js: IndexedDB, not localStorage, because a project (bible + plan +
     several units of full rich-field markdown + continuity history) is much
     bigger than a Script Library entry and would fill localStorage's ~5-10MB
     origin-wide cap fast. Nothing here is ever sent to or stored on any
     server — same guarantee as everything else in this app. */
  const LF_DB_NAME = "sf_longform_projects", LF_STORE = "projects";
  function lfDbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(LF_DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(LF_STORE, { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function lfGetAll() {
    try {
      const db = await lfDbOpen();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(LF_STORE, "readonly").objectStore(LF_STORE).getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return []; }
  }
  async function lfGet(id) {
    try {
      const db = await lfDbOpen();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(LF_STORE, "readonly").objectStore(LF_STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return null; }
  }
  async function lfPut(project) {
    project.updatedAt = Date.now();
    const db = await lfDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LF_STORE, "readwrite");
      tx.objectStore(LF_STORE).put(project);
      tx.oncomplete = () => resolve(project);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function lfDelete(id) {
    const db = await lfDbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LF_STORE, "readwrite");
      tx.objectStore(LF_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  function uid(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`; }

  /* ═══════════════ 2. RUNTIME PLANNER — "Generation Unit Capacity" ═══════════════
     This is the abstraction the spec asked for explicitly: never hard-code
     "5 minutes", derive how much a single call can safely hold from the
     REAL per-provider output-token ceilings already defined in app.js
     (PROVIDER_MAX_OUTPUT_TOKENS) and the same request-size formula
     computeMaxTokens() already uses. If a future provider raises its ceiling,
     or a new provider is added to PROVIDER_MAX_OUTPUT_TOKENS in app.js, this
     planner picks it up automatically with zero changes here.

     SAFETY MARGIN: deliberately budgets to 65% of the real ceiling, not 100%.
     Two reasons, both concrete, not hypothetical: (1) a single call using the
     full ceiling means tens of thousands of tokens of uninterrupted output
     with nothing checking it against the rest of the story until it's already
     done — smaller units mean the Continuity Extraction pass (section 12/26)
     runs more often and catches drift sooner. (2) the Cloudflare Pages
     Functions relay's execution-time limits for a single request were not
     verified during the architecture audit — staying well under the raw
     ceiling keeps individual calls fast rather than betting the whole
     project's reliability on a single very long request. */
  const LONGFORM_SAFETY_MARGIN = 0.65;
  const LONGFORM_REQUEST_BASE = 2000, LONGFORM_REQUEST_PER_SEGMENT = 900; // mirrors computeMaxTokens()'s own formula in app.js

  function lfProviderCeiling(provider, model) {
    let ceiling = (typeof PROVIDER_MAX_OUTPUT_TOKENS !== "undefined") ? PROVIDER_MAX_OUTPUT_TOKENS[provider] : null;
    if (ceiling && typeof ceiling === "object") ceiling = ceiling[model] || ceiling.default;
    return ceiling || 16000;
  }

  /* Generation Unit Capacity, expressed in segments (the app's own atomic
     unit). Never below 2 — a "unit" of a single segment defeats the point of
     batching (all overhead, no room for a real beat). */
  function computeUnitCapacitySegments(provider, model) {
    const budget = lfProviderCeiling(provider, model) * LONGFORM_SAFETY_MARGIN;
    const maxSegments = Math.floor((budget - LONGFORM_REQUEST_BASE) / LONGFORM_REQUEST_PER_SEGMENT);
    return Math.max(2, maxSegments);
  }

  /* Turns a target runtime into a concrete Generation Unit Plan: how many
     total segments the existing timing model (segEndTime/segStartTime, 10s
     for segments 1-3, 15s from segment 4 on, UNCHANGED from app.js) needs to
     reach or exceed that runtime, then slices those segments into
     consecutive batches no larger than this provider's Generation Unit
     Capacity. Global segment numbering is preserved across units (unit 2
     might start at segment 19, not segment 1) so every segment's timestamp
     in the final assembled script is correct without any renumbering. */
  function planUnits(targetRuntimeSeconds, provider, model) {
    const capacitySegs = computeUnitCapacitySegments(provider, model);
    let totalSegments = 3;
    while (segEndTime(totalSegments) < targetRuntimeSeconds) totalSegments++;
    const units = [];
    let start = 1;
    while (start <= totalSegments) {
      const end = Math.min(start + capacitySegs - 1, totalSegments);
      units.push({
        index: units.length + 1,
        startSeg: start, endSeg: end,
        startSec: segStartTime(start), endSec: segEndTime(end),
        status: "ready" // ready | generating | generated | locked | stale
      });
      start = end + 1;
    }
    return { totalSegments, totalRuntimeSeconds: segEndTime(totalSegments), capacitySegs, units };
  }

  /* ═══════════════ 3. JOB-BASED MODEL ROUTING ═══════════════
     Section 22 of the spec: different long-form jobs should be able to use
     different models. Generation Units reuse the app's EXISTING per-script-
     type PRODUCTION_TYPE_WEIGHTS unchanged (it's already tuned for "write
     good content of this type"). Master Architecture and Continuity
     Extraction are new job types this file adds weight profiles for, scored
     against the SAME MODEL_CAPABILITIES table and the SAME scoreModel()
     function already in app.js — no new capability data invented, just a
     different weighting of the numbers that already exist. */
  const LONGFORM_JOB_WEIGHTS = {
    masterBible: { reasoning: .35, longContext: .3, storytelling: .2, research: .15 },
    continuity: { reasoning: .5, longContext: .3, dialogue: .2 } // extraction+validation: structured, not creative
  };

  function pickModelForJob(job) {
    const weights = LONGFORM_JOB_WEIGHTS[job];
    if (!weights || typeof MODEL_CAPABILITIES === "undefined") return null;
    const anyKeyPresent = Object.keys(PROVIDER_KEY_FIELD).some(p => providerHasKey(p));
    const pool = anyKeyPresent ? MODEL_CAPABILITIES.filter(m => providerHasKey(m.provider)) : MODEL_CAPABILITIES;
    if (!pool.length) return null;
    const scored = pool.map(entry => ({ entry, score: scoreModel(entry, weights) }));
    scored.sort((a, b) => b.score - a.score);
    // Continuity is a cheap structured task, not a creative one: among anything
    // within 1.0 of the top score, prefer the cheapest/fastest rather than the
    // single highest-scoring model. This is the cost-awareness section 23 asks
    // for, applied concretely instead of just as a UI estimate.
    if (job === "continuity") {
      const near = scored.filter(s => s.score >= scored[0].score - 1.0);
      near.sort((a, b) => {
        const costRank = { low: 0, medium: 1, high: 2 };
        const c = (costRank[a.entry.cost] || 1) - (costRank[b.entry.cost] || 1);
        if (c !== 0) return c;
        return (SPEED_RANK[b.entry.speed] || 0) - (SPEED_RANK[a.entry.speed] || 0);
      });
      return near[0].entry;
    }
    return scored[0].entry;
  }

  /* ═══════════════ 4. /api/format CALL HELPER ═══════════════
     Same endpoint, same request shape, same response shape Quick Generation
     already uses — this is the actual "orchestration layer around the
     existing generation capability," not a parallel generation path. */
  async function sfCallFormat({ provider, model, max_tokens, system, userMsg }) {
    const keyField = PROVIDER_KEY_FIELD[provider];
    const apiKey = (els[keyField] && els[keyField].value || "").trim();
    if (!apiKey) throw new Error(`No API key entered for ${provider}. Add one in section 2 (API Configuration) first.`);
    const res = await fetch("/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, apiKey, model, max_tokens, system, messages: [{ role: "user", content: userMsg }] })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
    const text = ((data && data.content) || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    if (!text) throw new Error("Empty response from provider.");
    return text;
  }

  function jobModelChoice(job, fallbackProvider, fallbackModel) {
    const picked = pickModelForJob(job);
    if (picked && providerHasKey(picked.provider)) return { provider: picked.provider, model: picked.model };
    return { provider: fallbackProvider, model: fallbackModel };
  }

  /* ═══════════════ 5. MASTER STORY / SCRIPT BIBLE + MASTER PLAN ═══════════════
     Section 8/9/10. One combined call: the Master Bible (story-agnostic,
     adapted per script type) AND the per-unit beats/purpose for the Runtime
     Plan this code already computed deterministically. ScriptForge decides
     HOW MANY units and WHAT TIME RANGE each covers (planUnits(), above); the
     model only decides WHAT HAPPENS in each one — the section 34 split. */
  const MASTER_BIBLE_FIELDS = {
    "Short Movie Script": ["protagonist", "antagonist", "supportingCharacters", "conflict", "stakes", "characterArcs", "turningPoints", "climax", "resolution"],
    "Short Documentary": ["centralSubject", "researchQuestions", "chronology", "evidenceStructure", "interviewStructure", "thematicProgression", "conclusion"],
    "Short Advert": ["brandObjective", "audience", "hook", "problem", "productIntroduction", "emotionalProgression", "proof", "cta"],
    "Podcast": ["episodeStructure", "hostStructure", "speakerStructure", "topicProgression", "transitions", "audienceEngagement", "conclusion"],
    "Public Address": ["speaker", "objective", "audience", "keyMessages", "structure", "rhetoricalDevices", "conclusion"]
  };
  const DEFAULT_BIBLE_FIELDS = ["premise", "structure", "conclusion"];

  function buildMasterBiblePrompt(scriptType, idea, ratio, allowBRoll, plan) {
    const typeFields = MASTER_BIBLE_FIELDS[scriptType] || DEFAULT_BIBLE_FIELDS;
    const unitList = plan.units.map(u => `Unit ${u.index}: ${tstamp(u.startSec)}–${tstamp(u.endSec)} (${u.endSec - u.startSec}s, segments ${u.startSeg}-${u.endSeg})`).join("\n");
    const system = `You are the story architect for a ${scriptType || "video"} production. Read the user's idea/synopsis and design the COMPLETE production before any script is written, so a separate process can generate it in ${plan.units.length} ordered piece${plan.units.length > 1 ? "s" : ""} that read as one continuous, escalating production rather than ${plan.units.length > 1 ? "several disconnected mini-stories" : "a flat, unstructured scene"}.

Output ONLY a single valid JSON object, no markdown code fence, no commentary, matching exactly this shape:

{
  "title": string,
  "logline": string,
  "themes": [string],
  "audience": string,
  "tone": string,
  "visualStyle": string,
  "characters": [ { "name": string, "role": string, "description": string, "voice": string } ],
  "locations": [ { "name": string, "description": string } ],
  "keyFacts": [string],
  "plannedReveals": [string],
  "ending": string,
  "typeSpecific": { ${typeFields.map(f => `"${f}": string`).join(", ")} },
  "unitBeats": [
    ${plan.units.map(u => `{ "index": ${u.index}, "purpose": string, "requiredContent": string, "requiredBeats": [string], "forbiddenInfo": [string], "endingRequirement": string }`).join(",\n    ")}
  ]
}

The production will be generated in exactly this many time-boxed pieces, already decided, do not change the count or timing:
${unitList}

Rules:
1. This is ONE continuous production. unitBeats must show real forward progression, rising stakes/escalation/information revelation across units, never the same beat repeated or the story restarting in a later unit.
2. forbiddenInfo lists anything that must NOT be revealed yet in that unit because it is scheduled for a later one (section: information/reveal control). The final unit's forbiddenInfo should normally be empty.
3. endingRequirement for every unit except the last describes how it hands off into the next (open thread, rising question, unresolved beat). The last unit's endingRequirement describes how the whole production resolves and closes.
4. Adapt typeSpecific to what a ${scriptType || "generic"} production actually needs, do not force a movie three-act structure onto a non-narrative format.
5. Never use an em dash ("—") anywhere in any field. Use a comma or period instead.
6. Visual style should account for a ${ratio} frame${allowBRoll ? " and may include B-roll/cutaway coverage" : ", on-camera only, no cutaway B-roll shots"}.`;
    const userMsg = `Idea / synopsis:\n\n${idea}`;
    return { system, userMsg };
  }

  function extractJson(text) {
    let s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const first = s.indexOf("{"), last = s.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("Model did not return JSON.");
    return JSON.parse(s.slice(first, last + 1));
  }

  /* ═══════════════ MOCK TEST MODE ═══════════════
     Same spirit as app.js's existing "🧪 Run Mock Test" button for Quick
     Generation: no API key, no /api/format call, no deployment required.
     Lets the whole project state machine (planning, bible, unit generation,
     locking, regenerate-from-here staleness, continuity view, assembly, and
     the hand-off to renderOutput()/Library) be exercised entirely client-side
     by opening index.html locally, answering "can I test this today" with
     zero infrastructure. Output still goes through the exact same segment
     markdown template renderOutput() parses, so the render path itself is
     genuinely tested, not skipped. */
  function mockMasterBible(project) {
    const plan = project.masterPlan;
    const idea = (project.idea || "").trim().slice(0, 80);
    const typeFields = MASTER_BIBLE_FIELDS[project.scriptType] || DEFAULT_BIBLE_FIELDS;
    const typeSpecific = {};
    typeFields.forEach(f => { typeSpecific[f] = `[mock] ${f} derived from: ${idea}`; });
    const n = plan.units.length;
    return {
      title: idea || "Mock Project", logline: `[mock] A ${project.scriptType || "production"} about: ${idea}`,
      themes: ["mock theme one", "mock theme two"], audience: "[mock] general audience", tone: "[mock] measured, engaging",
      visualStyle: `[mock] cinematic ${project.ratio}, documentary grade`,
      characters: [{ name: "Mock Subject A", role: "lead", description: "[mock] placeholder description", voice: "[mock] clear, warm" }],
      locations: [{ name: "Mock Location", description: "[mock] placeholder setting" }],
      keyFacts: ["[mock] fact one", "[mock] fact two"], plannedReveals: ["[mock] reveal scheduled for a later unit"],
      ending: "[mock] the production resolves its central question", typeSpecific,
      unitBeats: plan.units.map(u => ({
        index: u.index,
        purpose: u.index === 1 ? "[mock] establish setup" : u.index === n ? "[mock] climax and resolution" : `[mock] rising complication ${u.index - 1}`,
        requiredContent: "[mock] required content placeholder",
        requiredBeats: ["[mock] beat A", "[mock] beat B"],
        forbiddenInfo: u.index === n ? [] : ["[mock] the ending, saved for the final unit"],
        endingRequirement: u.index === n ? "[mock] resolve and close" : "[mock] end on an open thread"
      }))
    };
  }
  function mockSegmentBlock(project, s) {
    const type = project.allowBRoll && s % 3 === 0 ? "Voiceover + B-Roll" : "On-Camera";
    return `### SEGMENT ${s} | ${tstamp(segStartTime(s))}–${tstamp(segEndTime(s))}

**Type**: ${type}

**TTS Script**:
> [mock] Placeholder spoken line for segment ${s}, standing in for real generated dialogue.

**Text-to-Image Prompt**:
> [mock] Placeholder ${project.ratio} still-frame description for segment ${s}.

**Image-to-Video Prompt**:
> [mock] Placeholder camera motion description for segment ${s}.

**Camera Movement**:
> [mock] Slow dolly-in.

**Lighting**:
> [mock] Soft daylight, neutral color temperature.

**Mood**:
> [mock] Even, exploratory.

**Audio Note**:
> [mock] Quiet ambient room tone under clear narration.

**Continuity Prompt**:
> [mock] Placeholder bridge into the next segment.
`;
  }
  function mockUnitRaw(project, unit) {
    const blocks = [];
    for (let s = unit.startSeg; s <= unit.endSeg; s++) blocks.push(mockSegmentBlock(project, s));
    return blocks.join("\n---\n\n");
  }
  function mockContinuityState(project, unit) {
    return {
      currentPosition: `[mock] end of unit ${unit.index}`, whatHasHappened: "[mock] placeholder summary of events so far",
      currentObjective: "[mock] placeholder objective", currentConflict: "[mock] placeholder conflict",
      unresolvedItems: ["[mock] unresolved thread"], resolvedItems: [],
      characterStates: [{ name: "Mock Subject A", state: "[mock] steady" }], locationStates: [{ name: "Mock Location", state: "[mock] unchanged" }],
      timelineState: "[mock] continuous", audienceKnowledge: "[mock] partial", characterKnowledge: "[mock] partial",
      importantFacts: [], revealsCompleted: [], revealsPending: ["[mock] pending reveal"],
      visualState: "[mock] consistent", productionState: "[mock] on track", currentTensionPacing: "[mock] rising",
      nextRequiredBeats: ["[mock] next beat"], lastLineForBridge: "[mock] Placeholder bridge into the next segment."
    };
  }

  async function generateMasterBible(project) {
    const plan = project.masterPlan;
    let bible, choice = null;
    if (project.mock) {
      await new Promise(r => setTimeout(r, 400));
      bible = mockMasterBible(project);
    } else {
      const { system, userMsg } = buildMasterBiblePrompt(project.scriptType, project.idea, project.ratio, project.allowBRoll, plan);
      choice = jobModelChoice("masterBible", project.provider, project.model);
      const text = await sfCallFormat({ provider: choice.provider, model: choice.model, max_tokens: 6000, system, userMsg });
      bible = extractJson(text);
    }
    project.masterBible = bible;
    project.masterBibleModel = choice;
    project.bibleLocked = false;
    project.status = "bible_ready";
    await lfPut(project);
    return project;
  }

  /* ═══════════════ 6. GENERATION UNIT — reuses app.js's own segment template ═══════════════
     This mirrors buildSystemPrompt() in app.js field-for-field (same 8 fields
     per segment, same em-dash ban, same single-axis camera rule, same
     documentary-grade visual direction) but generalizes segment numbering to
     an arbitrary starting point instead of always 1, and prepends the
     Master Bible + this unit's plan + the Continuity State instead of
     nothing. Kept separate from app.js's buildSystemPrompt() rather than
     modifying it, so Quick Generation's prompt is completely untouched. */
  function buildUnitSystemPrompt(project, unit, continuityState) {
    const { startSeg, endSeg } = unit;
    const ratio = project.ratio, allowBRoll = project.allowBRoll;
    const timingRule = [];
    for (let s = startSeg; s <= endSeg; s++) timingRule.push(`Segment ${s} = ${tstamp(segStartTime(s))}–${tstamp(segEndTime(s))} (${segDuration(s)}s)`);
    const isFirst = unit.index === 1, isLast = unit.index === project.masterPlan.units.length;
    const beats = (project.masterBible.unitBeats || []).find(b => b.index === unit.index) || {};

    const continuitySection = isFirst ? `This is the FIRST unit of the production. There is no prior context, establish the world and characters as described in the Master Bible below.` : `This is unit ${unit.index} of ${project.masterPlan.units.length}. It must continue DIRECTLY from where the previous unit left off, do not re-introduce characters, do not restate established facts as if new, do not reset tension/pacing back to a neutral starting point. Segment ${startSeg}'s opening should read as the immediate continuation of the following:

CONTINUITY STATE (authoritative, produced by extracting what happened in every prior unit):
${JSON.stringify(continuityState, null, 2)}

The literal last line/bridge from the previous unit, continue from this directly: "${(continuityState && continuityState.lastLineForBridge) || ""}"`;

    const system = `Act as a professional AI video production formatter and screenwriter. You are writing ONE PIECE of a longer, already-planned ${project.scriptType || "video"} production, segments ${startSeg} through ${endSeg} (${tstamp(segStartTime(startSeg))}–${tstamp(segEndTime(endSeg))} of a ${tstamp(project.masterPlan.totalRuntimeSeconds)} total production). Do not write a self-contained mini-story, this must read as a direct continuation of one continuous production.

MASTER STORY BIBLE (authoritative source, do not contradict):
${JSON.stringify({ title: project.masterBible.title, logline: project.masterBible.logline, themes: project.masterBible.themes, tone: project.masterBible.tone, visualStyle: project.masterBible.visualStyle, characters: project.masterBible.characters, locations: project.masterBible.locations, keyFacts: project.masterBible.keyFacts, typeSpecific: project.masterBible.typeSpecific }, null, 2)}

THIS UNIT'S OBJECTIVE:
Purpose: ${beats.purpose || "Advance the production."}
Required content: ${beats.requiredContent || "N/A"}
Required beats: ${(beats.requiredBeats || []).join("; ") || "N/A"}
Forbidden/premature information (do NOT reveal yet): ${(beats.forbiddenInfo || []).join("; ") || "None"}
Ending requirement: ${beats.endingRequirement || (isLast ? "Resolve and close the production." : "End on an open thread that pulls into the next unit.")}

${continuitySection}

Follow this exact structure for EVERY segment in this unit. Keep wording clear and concise, match the tone and visual style established above, and ensure smooth natural continuity between segments.

---

### SEGMENT [NUMBER] | [START TIME]–[END TIME]

**Type**: [${allowBRoll ? "On-Camera / Voiceover + B-Roll / On-Camera + Brand Close" : "On-Camera / On-Camera + Brand Close"}]

**TTS Script**:
> [Full spoken text for this exact segment duration. WORD-COUNT TARGET: roughly 22-28 words for a 10-second segment, roughly 33-42 words for a 15-second segment, a genuine line at that length, never a bare fragment. Write like a working screenwriter: spoken rhythm, contractions, natural interruption or trailing off where it fits. Weave in sensory-grounded environmental detail economically. Build mood through word choice and pacing rather than naming it. Every speaking character keeps the distinct voice established in the Master Bible above. Show what the moment looks, sounds, and feels like rather than stating a conclusion about it, and avoid dialogue that only informs the audience of facts characters would already know.]

**Text-to-Image Prompt**:
> [Detailed, photorealistic ${ratio} still-frame prompt: subject, setting, wardrobe/props, framing, style, consistent with any character/location descriptions already established in the Master Bible above.]

**Image-to-Video Prompt**:
> [Only the kinetic action and camera path for this segment's duration. Do NOT include descriptive adjectives about appearance, clothing, environment, or objects, describe motion and camera path only.]

**Camera Movement**:
> [Exactly ONE single-axis camera motion: pure horizontal pan, pure vertical tilt, or a steady linear dolly-in/out. Never combine axes, never fully static. Vary axis/direction from the previous segment.]

**Lighting**:
> [Lighting setup: source, direction, color temperature, time of day, consistent with this unit's established visual state.]

**Mood**:
> [Overall emotional tone in a few words, matching the mood built through the TTS Script above.]

**Audio Note**:
> [MANDATORY, audible detail only. The specific ambient environmental soundscape this setting would realistically have. No real-world location is ever silent.]

**Continuity Prompt**:
> [MANDATORY, the bridge from this segment into the next. For the FINAL segment of this unit, describe how this unit hands off to ${isLast ? "the production's resolution" : "the next unit"} instead of the next segment within this unit if this is the unit's last segment.]

---

Additional rules:
1. Keep all timing precise: ${timingRule.join(", ")}
2. Preserve all facts, names, and details from the Master Story Bible exactly, never contradict it. If this unit is not first, never contradict the Continuity State above either.
3. Output as clean, copy-paste ready blocks exactly like the sample format.
4. Pace TTS at approximately 150 spoken words per minute for each segment's specific duration.
5. Visuals: cinematic documentary grade, ultra-realistic African physiognomy where people appear, specify era, geography, lighting, composition, never generic stock-photo descriptors.
6. Never use an em dash (the "—" character) anywhere in the output. Use a comma, a period, or the word "and" instead.
7. Camera Movement is always single-axis only, never combine axes, never fully static, vary axis/direction across segments so it never repeats twice in a row.
8. B-Roll handling: ${allowBRoll ? "Voiceover + B-Roll segments are allowed and encouraged where they suit the content." : "B-Roll is DISABLED. Every segment's Type must be On-Camera or On-Camera + Brand Close only, the on-camera subject stays in frame at all times."}
9. Do not reveal anything listed as forbidden/premature information above.
10. This unit must advance the production (rising stakes, new information, forward motion), it must never simply restate or reset what earlier units already established.
11. Output ONLY the formatted segment blocks for segments ${startSeg} through ${endSeg}. No preamble, no commentary, no closing remarks, no TECHNICAL SPECS block (that is added separately only once, at final assembly).`;

    return system;
  }

  async function generateUnit(project, unitIndex) {
    const unit = project.masterPlan.units.find(u => u.index === unitIndex);
    if (!unit) throw new Error("Unknown unit.");
    unit.status = "generating";
    await lfPut(project);
    const priorState = project.continuityStates[unitIndex - 1] || null; // state AFTER previous unit, or null for unit 1
    const n = unit.endSeg - unit.startSeg + 1;
    let raw;
    if (project.mock) {
      await new Promise(r => setTimeout(r, 400 + n * 60)); // simulate proportional latency
      raw = mockUnitRaw(project, unit);
    } else {
      const system = buildUnitSystemPrompt(project, unit, priorState);
      const max_tokens = computeMaxTokens(n, project.provider, project.model);
      try {
        raw = await sfCallFormat({ provider: project.provider, model: project.model, max_tokens, system, userMsg: `Write segments ${unit.startSeg} through ${unit.endSeg} now.` });
      } catch (e) {
        unit.status = unit.raw ? "generated" : "ready"; // preserve prior canonical content on failure, section 28
        await lfPut(project);
        throw e;
      }
    }
    unit.raw = raw;
    unit.versions = unit.versions || [];
    unit.versions.push({ raw, createdAt: Date.now() });
    unit.currentVersion = unit.versions.length - 1;
    unit.status = "generated";
    await lfPut(project);

    // Continuity Extraction + Validation, section 12/26/27, combined into one
    // call (cost-awareness, section 23) rather than two separate ones.
    try {
      if (project.mock) {
        await new Promise(r => setTimeout(r, 200));
        project.continuityStates[unitIndex] = mockContinuityState(project, unit);
        unit.warnings = [];
      } else {
        const result = await extractContinuity(project, unit, priorState);
        project.continuityStates[unitIndex] = result.state;
        unit.warnings = result.warnings || [];
      }
    } catch (e) {
      unit.warnings = [`Continuity check failed to run: ${e.message}. Content was generated and saved, but continuity for the next unit could not be updated automatically, review manually before generating the next unit.`];
    }
    await lfPut(project);
    return project;
  }

  /* ═══════════════ 7. CONTINUITY EXTRACTION + VALIDATION ═══════════════
     Section 12 (state) and 26/27 (validation/warnings) in one call. Deliberately
     small and structured, routed to a fast/cheap model by pickModelForJob()
     above rather than the same model doing the creative writing. */
  function buildContinuityPrompt(project, unit, priorState) {
    const system = `You extract structured continuity state from a just-written piece of a longer ${project.scriptType || "video"} production, and flag any contradiction with what was established before.

Output ONLY a single valid JSON object, no markdown fence, no commentary:
{
  "state": {
    "currentPosition": string,
    "whatHasHappened": string,
    "currentObjective": string,
    "currentConflict": string,
    "unresolvedItems": [string],
    "resolvedItems": [string],
    "characterStates": [ { "name": string, "state": string } ],
    "locationStates": [ { "name": string, "state": string } ],
    "timelineState": string,
    "audienceKnowledge": string,
    "characterKnowledge": string,
    "importantFacts": [string],
    "revealsCompleted": [string],
    "revealsPending": [string],
    "visualState": string,
    "productionState": string,
    "currentTensionPacing": string,
    "nextRequiredBeats": [string],
    "lastLineForBridge": string
  },
  "warnings": [string]
}

"lastLineForBridge" must be the literal final Continuity Prompt text from the last segment below, used verbatim so the next unit can continue from it exactly.

For "warnings": compare the new content against the Master Bible and the PRIOR continuity state (both given below) and flag any real conflict involving character identity, character knowledge, character location, chronology, appearance, wardrobe, props, environment, established facts, dialogue/terminology, previous events, or narrative logic. Each warning should be one specific, concrete sentence. If there are no real conflicts, return an empty array, do not invent minor stylistic nitpicks.

MASTER STORY BIBLE:
${JSON.stringify(project.masterBible, null, 2)}

PRIOR CONTINUITY STATE (null if this is the first unit):
${JSON.stringify(priorState)}`;
    const userMsg = `The content just written (segments ${unit.startSeg}-${unit.endSeg}):\n\n${unit.raw}`;
    return { system, userMsg };
  }

  async function extractContinuity(project, unit, priorState) {
    const { system, userMsg } = buildContinuityPrompt(project, unit, priorState);
    const choice = jobModelChoice("continuity", project.provider, project.model);
    const text = await sfCallFormat({ provider: choice.provider, model: choice.model, max_tokens: 3000, system, userMsg });
    return extractJson(text);
  }

  /* ═══════════════ 8. MASTER SCRIPT ASSEMBLY ═══════════════
     Section 20/21: concatenate every LOCKED unit's raw markdown, in order,
     preserving timestamps and structure (already globally correct, see
     planUnits()), add exactly one TECHNICAL SPECS header, then hand the
     result to app.js's OWN renderOutput() and the OWN Script Library/PDF
     buttons — the assembled long-form script becomes an ordinary Library
     entry, indistinguishable downstream from a Quick Generation script. */
  function assembleMasterScript(project) {
    const units = project.masterPlan.units;
    const missing = units.filter(u => u.status !== "locked" && u.status !== "generated");
    if (missing.length) throw new Error(`Units not ready yet: ${missing.map(u => u.index).join(", ")}. Generate and approve every unit before assembling.`);
    let specs = `Script type: ${project.scriptType || "N/A"}\nRatio: ${project.ratio}\n`;
    if (project.techSpecs) specs += `Specs: ${project.techSpecs}\n`;
    specs += `Total runtime: ${tstamp(project.masterPlan.totalRuntimeSeconds)} across ${units.length} generation unit${units.length > 1 ? "s" : ""}\n`;
    const body = units.map(u => (u.raw || "").trim()).join("\n\n---\n\n");
    const raw = `TECHNICAL SPECS\n${specs}\n---\n\n${body}`;
    project.assembledMasterScript = raw;
    project.status = "complete";
    return raw;
  }

  /* ═══════════════ 9. PROJECT ACTIONS (public, called from UI wiring below) ═══════════════ */
  async function createProject({ idea, scriptType, ratio, allowBRoll, techSpecs, targetRuntimeSeconds, provider, model, mock }) {
    const plan = planUnits(targetRuntimeSeconds, provider, model);
    const project = {
      id: uid("proj"), createdAt: Date.now(), updatedAt: Date.now(),
      title: (idea || "Untitled project").trim().split(/\s+/).slice(0, 8).join(" ") + (mock ? " (mock)" : ""),
      idea, scriptType, ratio, allowBRoll, techSpecs,
      targetRuntimeSeconds, provider, model, mock: !!mock,
      masterPlan: plan,
      masterBible: null, bibleLocked: false,
      continuityStates: [null], // index 0 = "before unit 1" (nothing yet)
      status: "bible_pending",
      assembledMasterScript: null
    };
    // masterPlan.units already carries status per unit; give each a place for raw/versions
    project.masterPlan.units.forEach(u => { u.raw = null; u.versions = []; u.currentVersion = -1; u.warnings = []; });
    await lfPut(project);
    return project;
  }

  async function lockUnit(project, unitIndex) {
    const unit = project.masterPlan.units.find(u => u.index === unitIndex);
    if (!unit || !unit.raw) throw new Error("Nothing to lock yet.");
    unit.status = "locked";
    await lfPut(project);
  }

  async function editUnit(project, unitIndex, newRaw) {
    const unit = project.masterPlan.units.find(u => u.index === unitIndex);
    unit.raw = newRaw;
    unit.versions.push({ raw: newRaw, createdAt: Date.now(), edited: true });
    unit.currentVersion = unit.versions.length - 1;
    unit.status = "locked"; // manual edits are canonical immediately, section 25
    await lfPut(project);
  }

  async function regenerateFromHere(project, unitIndex) {
    project.masterPlan.units.forEach(u => {
      if (u.index > unitIndex && (u.status === "generated" || u.status === "locked")) u.status = "stale";
    });
    await lfPut(project);
    return generateUnit(project, unitIndex);
  }

  function lockBible(project) { project.bibleLocked = true; return lfPut(project); }
  function unlockBible(project) { project.bibleLocked = false; return lfPut(project); }

  /* ═══════════════ 10. UI ═══════════════
     Reuses existing CSS classes only (card, field, fl, fv, status, badge,
     btn-primary, btn-ghost, btn-copy, lib-overlay, lib-panel, lib-item,
     lib-note, seg-card, empty) — no new CSS added anywhere. Event handling
     uses one delegated click listener reading data-lf-action, matching the
     data-action delegation pattern already used elsewhere in this app. */
  let currentProject = null;

  function statusBadge(status) {
    const map = { ready: "○ READY", generating: "… GENERATING", generated: "○ GENERATED", locked: "✓ LOCKED", stale: "⚠ STALE" };
    const color = { ready: "var(--muted)", generating: "var(--accent2)", generated: "var(--warn)", locked: "var(--ok)", stale: "var(--err)" };
    return `<span style="color:${color[status] || "var(--muted)"};font-weight:600">${map[status] || status}</span>`;
  }

  async function renderProjectList() {
    const list = await lfGetAll();
    const el = $("longformProjectList");
    if (!list.length) { el.innerHTML = '<div class="lib-empty">No long-form projects yet. Click + New Project to start one.</div>'; return; }
    el.innerHTML = list.map(p => `
      <div class="lib-item">
        <div class="meta">
          <div class="t">${esc(p.title || "Untitled")}</div>
          <div class="d">${esc(p.scriptType || "")} · ${tstamp(p.masterPlan.totalRuntimeSeconds)} target · ${p.masterPlan.units.length} unit${p.masterPlan.units.length > 1 ? "s" : ""} · ${new Date(p.updatedAt).toLocaleString()}</div>
        </div>
        <button class="btn-copy" data-lf-action="open-project" data-lf-id="${p.id}">Open</button>
        <button class="btn-copy" style="color:var(--err)" data-lf-action="delete-project" data-lf-id="${p.id}">Delete</button>
      </div>`).join("");
  }

  function renderBibleView(project) {
    if (!project.masterBible) {
      return `<div class="empty">No Master Bible yet.<br><br><button class="btn-primary" data-lf-action="gen-bible" style="width:auto;padding:9px 20px">Generate Master Bible</button></div>`;
    }
    const b = project.masterBible;
    const lockRow = project.bibleLocked
      ? `<div class="status ok" style="display:block">✓ Master Bible is LOCKED — units must stay consistent with it. <button class="btn-copy" data-lf-action="unlock-bible" style="margin-left:8px">Unlock</button></div>`
      : `<div class="status info" style="display:block">Review the bible below, then lock it before generating units so later units can't silently drift from it. <button class="btn-primary" data-lf-action="lock-bible" style="width:auto;padding:6px 16px;margin-top:8px">🔒 Lock Master Bible</button> <button class="btn-ghost" data-lf-action="gen-bible" style="width:auto;padding:6px 16px;margin-top:8px">Regenerate</button></div>`;
    return `
      <div class="specs-block">
        <div class="fl">${esc(b.title || "")}</div>
        <div style="margin-bottom:8px"><i>${esc(b.logline || "")}</i></div>
        <div><b>Themes:</b> ${(b.themes || []).map(esc).join(", ")}</div>
        <div><b>Tone:</b> ${esc(b.tone || "")}</div>
        <div><b>Visual style:</b> ${esc(b.visualStyle || "")}</div>
        <div><b>Characters:</b> ${(b.characters || []).map(c => esc(c.name + " (" + c.role + ")")).join("; ")}</div>
        <div><b>Locations:</b> ${(b.locations || []).map(l => esc(l.name)).join("; ")}</div>
        <div><b>Ending:</b> ${esc(b.ending || "")}</div>
      </div>
      ${lockRow}`;
  }

  function renderUnitCard(project, unit) {
    const canGenerate = unit.status === "ready" || unit.status === "stale";
    const canLock = unit.raw && unit.status !== "locked";
    const warnings = (unit.warnings || []).map(w => `<div class="status err" style="display:block">⚠️ ${esc(w)}</div>`).join("");
    return `
      <div class="seg-card">
        <div class="seg-head">
          <div class="t">UNIT ${unit.index}<small>${tstamp(unit.startSec)}–${tstamp(unit.endSec)} · segments ${unit.startSeg}-${unit.endSeg}</small></div>
          <div>${statusBadge(unit.status)}</div>
        </div>
        <div class="seg-body">
          ${warnings}
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:${unit.raw ? "10px" : "0"}">
            ${canGenerate ? `<button class="btn-primary" style="width:auto;padding:8px 14px" data-lf-action="gen-unit" data-lf-unit="${unit.index}" ${project.bibleLocked ? "" : "disabled title=\"Lock the Master Bible first\""}>${unit.status === "stale" ? "Regenerate (stale)" : "Generate"}</button>` : ""}
            ${unit.raw ? `<button class="btn-ghost" style="width:auto;padding:8px 14px" data-lf-action="regen-unit" data-lf-unit="${unit.index}">🔄 Regenerate</button>` : ""}
            ${unit.raw ? `<button class="btn-ghost" style="width:auto;padding:8px 14px" data-lf-action="regen-from-here" data-lf-unit="${unit.index}">Regenerate from here</button>` : ""}
            ${canLock ? `<button class="btn-ghost" style="width:auto;padding:8px 14px;color:var(--ok);border-color:var(--ok)" data-lf-action="lock-unit" data-lf-unit="${unit.index}">Approve &amp; Lock</button>` : ""}
            ${unit.raw ? `<button class="btn-ghost" style="width:auto;padding:8px 14px" data-lf-action="edit-unit" data-lf-unit="${unit.index}">Edit</button>` : ""}
            ${project.continuityStates[unit.index] ? `<button class="btn-ghost" style="width:auto;padding:8px 14px" data-lf-action="view-continuity" data-lf-unit="${unit.index}">View Continuity</button>` : ""}
          </div>
          ${unit.raw ? `<textarea readonly rows="6" style="font-family:var(--mono);font-size:.78rem">${esc(unit.raw)}</textarea>` : ""}
        </div>
      </div>`;
  }

  function renderProjectDetail(project) {
    const plan = project.masterPlan;
    const allLocked = plan.units.every(u => u.status === "locked" || u.status === "generated");
    return `
      <button class="btn-ghost" data-lf-action="back-to-list" style="margin-bottom:12px">← Back to projects</button>
      <div class="specs-block">
        <div class="fl">Runtime Plan</div>
        Target: ${tstamp(project.targetRuntimeSeconds)} · Planned: ${tstamp(plan.totalRuntimeSeconds)} across ${plan.totalSegments} segments · Generation Unit Capacity for ${esc(project.provider)}/${esc(project.model)}: ${plan.capacitySegs} segments/call · Units required: ${plan.units.length}
      </div>
      <h2 style="margin:14px 0 8px">Master Story Bible</h2>
      <div id="longformBible">${renderBibleView(project)}</div>
      <h2 style="margin:18px 0 8px">Generation Units</h2>
      <div id="longformUnits">${plan.units.map(u => renderUnitCard(project, u)).join("")}</div>
      <div style="margin-top:16px">
        <button class="btn-primary" data-lf-action="assemble" ${allLocked ? "" : "disabled"} style="width:auto;padding:10px 20px">📽 Assemble Master Script</button>
        ${!allLocked ? `<span style="color:var(--muted);font-size:.75rem;margin-left:10px">Lock or generate every unit first.</span>` : ""}
      </div>`;
  }

  async function refreshDetail() {
    if (!currentProject) return;
    currentProject = await lfGet(currentProject.id); // reload from DB so all UI reflects saved state
    $("longformDetailView").innerHTML = renderProjectDetail(currentProject);
  }

  function showListView() {
    currentProject = null;
    $("longformListView").style.display = "";
    $("longformDetailView").style.display = "none";
    renderProjectList();
  }
  function showDetailView() {
    $("longformListView").style.display = "none";
    $("longformDetailView").style.display = "";
  }

  /* ═══════════════ 11. WIRING ═══════════════ */
  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") init();
  function init() {
    const btn = $("btnLongform");
    if (!btn) return; // markup not present, feature not installed in this HTML
    btn.addEventListener("click", () => { $("longformOverlay").classList.add("open"); showListView(); });
    $("btnLongformClose")?.addEventListener("click", () => $("longformOverlay").classList.remove("open"));
    $("longformOverlay")?.addEventListener("click", e => { if (e.target === $("longformOverlay")) $("longformOverlay").classList.remove("open"); });

    $("btnLongformNew")?.addEventListener("click", () => {
      $("longformListView").style.display = "none";
      $("longformNewView").style.display = "";
    });
    $("btnLongformNewCancel")?.addEventListener("click", () => {
      $("longformNewView").style.display = "none";
      $("longformListView").style.display = "";
    });
    $("longformTargetMinutes")?.addEventListener("input", () => {
      const mins = +$("longformTargetMinutes").value || 0;
      $("longformTargetPreview").textContent = mins ? `≈ ${Math.round(mins)} min target` : "";
    });

    $("btnLongformCreate")?.addEventListener("click", async () => {
      const idea = $("longformIdea").value.trim();
      if (!idea) { alert("Paste an idea or synopsis first."); return; }
      const mins = +$("longformTargetMinutes").value || 10;
      const scriptType = els.scriptType ? els.scriptType.value : "";
      const ratio = els.ratio ? els.ratio.value : "16:9";
      const allowBRoll = els.allowBRoll ? els.allowBRoll.checked : true;
      const techSpecs = els.techSpecs ? els.techSpecs.value.trim() : "";
      const provider = els.formatProvider ? els.formatProvider.value : "anthropic";
      const modelField = PROVIDER_MODEL_FIELD[provider];
      const model = els[modelField] ? els[modelField].value : "";
      const mock = $("longformMock") ? $("longformMock").checked : false;
      currentProject = await createProject({ idea, scriptType, ratio, allowBRoll, techSpecs, targetRuntimeSeconds: mins * 60, provider, model, mock });
      $("longformNewView").style.display = "none";
      showDetailView();
      await refreshDetail();
    });

    // Delegated click handler for everything inside the detail view
    $("longformOverlay")?.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-lf-action]");
      if (!t) return;
      const action = t.dataset.lfAction;
      const unitIndex = t.dataset.lfUnit ? +t.dataset.lfUnit : null;
      try {
        if (action === "back-to-list") { showListView(); return; }
        if (action === "open-project") { currentProject = await lfGet(t.dataset.lfId); showDetailView(); await refreshDetail(); return; }
        if (action === "delete-project") { if (confirm("Delete this project? This cannot be undone.")) { await lfDelete(t.dataset.lfId); renderProjectList(); } return; }
        if (action === "gen-bible") { t.disabled = true; t.textContent = "Generating…"; await generateMasterBible(currentProject); await refreshDetail(); return; }
        if (action === "lock-bible") { await lockBible(currentProject); await refreshDetail(); return; }
        if (action === "unlock-bible") { if (confirm("Unlock the Master Bible? Future units will no longer be checked against a locked reference.")) { await unlockBible(currentProject); await refreshDetail(); } return; }
        if (action === "gen-unit" || action === "regen-unit") {
          t.disabled = true; t.textContent = "Generating…";
          await generateUnit(currentProject, unitIndex);
          await refreshDetail();
          return;
        }
        if (action === "regen-from-here") {
          if (!confirm(`Regenerate unit ${unitIndex}? Any locked/generated units after it will be marked stale, not deleted, you choose whether to regenerate them.`)) return;
          t.disabled = true; t.textContent = "Regenerating…";
          await regenerateFromHere(currentProject, unitIndex);
          await refreshDetail();
          return;
        }
        if (action === "lock-unit") { await lockUnit(currentProject, unitIndex); await refreshDetail(); return; }
        if (action === "edit-unit") {
          const unit = currentProject.masterPlan.units.find(u => u.index === unitIndex);
          const edited = prompt("Edit this unit's raw markdown (advanced):", unit.raw);
          if (edited !== null) { await editUnit(currentProject, unitIndex, edited); await refreshDetail(); }
          return;
        }
        if (action === "view-continuity") {
          alert(JSON.stringify(currentProject.continuityStates[unitIndex], null, 2));
          return;
        }
        if (action === "assemble") {
          const raw = assembleMasterScript(currentProject);
          await lfPut(currentProject);
          // Hand off to app.js's OWN rendering + Library/PDF pipeline, section 21.
          window.lastRaw = raw;
          window.lastMeta = { n: currentProject.masterPlan.totalSegments, ratio: currentProject.ratio, type: currentProject.scriptType, date: new Date().toISOString(), longform: true, projectId: currentProject.id };
          renderOutput(raw);
          if (els.btnSaveLib) els.btnSaveLib.style.display = "inline-block";
          if (els.btnPdf) els.btnPdf.style.display = "inline-block";
          $("longformOverlay").classList.remove("open");
          alert("Master script assembled. It's now in the main output panel, ready to Save to Library or export exactly like a Quick Generation script.");
          return;
        }
      } catch (err) {
        alert("Error: " + err.message);
        await refreshDetail();
      }
    });
  }
})();
