/* Voice Passport core: locked, versioned ElevenLabs voices for ScriptForge characters.

   ADDITIVE ONLY. Pure logic, no DOM and no network, so it runs the same in the browser and in
   Node (tests/voice-passport.test.mjs). The browser screens are in assets/voice-passport-ui.js.
   To remove the feature: delete the two voice-passport script tags in scriptforge/index.html
   and the one voicePassport line in readDraftFromForm() in assets/app.js.

   What a Voice Passport is: for one character, the ElevenLabs voice ID, model, voice settings
   and delivery rules that every scene must reuse. A change of voice never overwrites an
   approved one: it adds the next version (v1, v2 ...) and keeps the old ones.

   Voice QA here checks duration fit, silence, clipping, loudness, pitch range, pace and pitch
   shift against the golden reference clip. It does NOT measure true speaker similarity (that
   needs a speaker-embedding model). evaluate() accepts a speakerSimilarity function so one can
   be plugged in later without changing anything else. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VoicePassportCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  var SAMPLE_RATE = 24000;

  /* eleven_multilingual_v2 is documented by ElevenLabs as the most stable on long-form output
     and covers Swedish. The older Turbo models are listed as deprecated. */
  var DEFAULT_MODEL_ID = "eleven_multilingual_v2";
  var DEFAULT_VOICE_SETTINGS = { stability: 0.7, similarity_boost: 0.85, style: 0.1 };
  var DEFAULT_DELIVERY_RULES = {
    pace: "conversational",
    energy: "warm, casual UGC creator",
    pauses: "natural",
    tone: "relatable, confident, slightly breathy",
    forbidden: "announcer tone, corporate ad-read, exaggerated acting"
  };
  var VOICE_SOURCES = ["library", "design", "clone"];
  var GOLDEN_TEST_LINES = [
    "Okay, be honest. How many unfinished videos are sitting in your drafts right now?",
    "I open the camera, stare, then close it.",
    "Some days I just sit there, completely stuck.",
    "Then I found ScriptForge.",
    "Follow for more creator tips, and save this for later."
  ];
  var EXTRA_TEST_LINES = [
    "And honestly, the hardest part was never the editing. It was knowing what to say.",
    "So I stopped overthinking it, and I just hit record."
  ];
  var DEFAULT_PAUSE_MS = { hook: 250, body: 150, cta: 0 };
  var PART_GAP_MS = 120;

  /* Calibrated on real ElevenLabs output: normal intonation (a question rising at the end)
     moves pitch several semitones inside one clip, so the tone-shift check only runs on
     clips of 5 seconds or more and allows 8 semitones. */
  var DEFAULT_THRESHOLDS = {
    maxClipRatio: 0.001,
    minPeak: 0.02,
    minSpeechSec: 0.3,
    durationToleranceSec: 0.25,
    pitchSemitones: 5,
    loudnessDb: 4,
    paceRatio: 0.3,
    driftSemitones: 8,
    minSecondsForDrift: 5,
    minSimilarity: 0.75,
    minVoicedFramesForPitch: 40,
    minSecondsForPace: 1.0
  };

  /* ------------------------------------------------------------------ small helpers */

  function slugify(name) {
    return String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function stableStringify(v) {
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + stableStringify(v[k]); }).join(",") + "}";
    }
    return JSON.stringify(v);
  }

  /* 53-bit string hash (cyrb53). An integrity check against accidental edits, not security. */
  function checksum(value) {
    var str = stableStringify(value), h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ passport store */

  var LOCKED_FIELDS = ["base_id", "character_id", "character_name", "elevenlabs_voice_id", "model_id",
    "voice_settings", "delivery_rules", "voice_source", "version"];

  function lockHash(p) {
    var locked = {};
    LOCKED_FIELDS.forEach(function (f) { locked[f] = p[f]; });
    return checksum(locked);
  }

  function validatePassport(p) {
    var errors = [];
    function isStr(v) { return typeof v === "string" && v.trim().length > 0; }
    function in01(v) { return typeof v === "number" && v >= 0 && v <= 1; }
    if (!p || typeof p !== "object") return { valid: false, errors: ["not an object"] };
    if (!isStr(p.character_name)) errors.push("character_name is required");
    if (!isStr(p.base_id)) errors.push("base_id is required");
    if (!isStr(p.elevenlabs_voice_id)) errors.push("elevenlabs_voice_id is required");
    if (!isStr(p.model_id)) errors.push("model_id is required");
    if (VOICE_SOURCES.indexOf(p.voice_source) < 0) errors.push("voice_source must be one of " + VOICE_SOURCES.join(", "));
    if (!/^v\d+$/.test(p.version || "")) errors.push("version must look like v1, v2");
    if (isStr(p.base_id) && p.character_id !== p.base_id + "_" + p.version) errors.push("character_id must equal base_id + _ + version");
    var s = p.voice_settings || {};
    ["stability", "similarity_boost", "style"].forEach(function (k) {
      if (!in01(s[k])) errors.push("voice_settings." + k + " must be a number from 0 to 1");
    });
    if (s.speed !== undefined && !(typeof s.speed === "number" && s.speed >= 0.7 && s.speed <= 1.2)) errors.push("voice_settings.speed must be between 0.7 and 1.2");
    return { valid: errors.length === 0, errors: errors };
  }

  /* A character's store: { schema_version, base_id, active, versions: { maya_ugc_v1: {...} } } */
  function emptyStore() {
    return { schema_version: SCHEMA_VERSION, base_id: null, active: null, versions: {} };
  }

  /* Pure: returns { store, passport } with the next version added. Earlier versions are kept
     exactly as they were and are marked superseded. */
  function addVersion(store, input) {
    var next = store && store.versions ? clone(store) : emptyStore();
    var baseId = next.base_id || (slugify(input.characterName) + "_ugc");
    if (baseId === "_ugc") throw new Error("Character name must contain letters or digits.");
    var numbers = Object.keys(next.versions).map(function (k) { return Number(next.versions[k].version.slice(1)); });
    var n = (numbers.length ? Math.max.apply(null, numbers) : 0) + 1;
    var settings = Object.assign({}, DEFAULT_VOICE_SETTINGS, input.voiceSettings || {});
    var p = {
      schema_version: SCHEMA_VERSION,
      base_id: baseId,
      character_id: baseId + "_v" + n,
      character_name: input.characterName,
      elevenlabs_voice_id: input.voiceId,
      voice_source: input.voiceSource,
      model_id: input.modelId || DEFAULT_MODEL_ID,
      voice_settings: settings,
      delivery_rules: Object.assign({}, DEFAULT_DELIVERY_RULES, input.deliveryRules || {}),
      reference_audio: { original_samples: (input.originalSamples || []).slice(), golden_reference_clip: "", golden_profile: null },
      version: "v" + n,
      status: "active",
      created_at: input.now || new Date().toISOString()
    };
    var v = validatePassport(p);
    if (!v.valid) throw new Error("Invalid voice passport: " + v.errors.join("; "));
    p.lock_hash = lockHash(p);
    if (next.versions[p.character_id]) throw new Error(p.character_id + " already exists and cannot be overwritten.");
    Object.keys(next.versions).forEach(function (k) { if (next.versions[k].status === "active") next.versions[k].status = "superseded"; });
    next.versions[p.character_id] = p;
    next.base_id = baseId;
    next.active = p.character_id;
    return { store: next, passport: p };
  }

  /* Detects hand edits to locked fields. */
  function verifyStore(store) {
    var problems = [];
    Object.keys((store && store.versions) || {}).forEach(function (k) {
      var p = store.versions[k];
      if (lockHash(p) !== p.lock_hash) problems.push(p.character_id + ": locked fields were changed outside the Voice Passport");
    });
    return { ok: problems.length === 0, problems: problems };
  }

  function getActive(store) {
    return store && store.active && store.versions ? store.versions[store.active] || null : null;
  }

  /* Explicit rollback to an older approved version. Nothing is modified or deleted. */
  function setActive(store, characterId) {
    if (!store.versions[characterId]) throw new Error("Unknown version " + characterId);
    var next = clone(store);
    Object.keys(next.versions).forEach(function (k) { next.versions[k].status = k === characterId ? "active" : "superseded"; });
    next.active = characterId;
    return next;
  }

  /* The only post-creation write: the golden reference profile (not part of the lock). */
  function attachGolden(store, characterId, info) {
    if (!store.versions[characterId]) throw new Error("Unknown version " + characterId);
    var next = clone(store);
    var ra = next.versions[characterId].reference_audio;
    ra.golden_reference_clip = info.clipName || "golden.wav";
    ra.golden_profile = info.profile;
    ra.golden_lines = info.lines || [];
    return next;
  }

  /* ------------------------------------------------------------------ audio helpers */

  function pcm16ToFloat(buf) {
    var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var n = Math.floor(u8.length / 2), out = new Float32Array(n);
    var dv = new DataView(u8.buffer, u8.byteOffset, n * 2);
    for (var i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
    return out;
  }

  function floatToPcm16(samples) {
    var out = new Uint8Array(samples.length * 2), dv = new DataView(out.buffer);
    for (var i = 0; i < samples.length; i++) {
      var v = Math.max(-1, Math.min(1, samples[i]));
      dv.setInt16(i * 2, Math.round(v * 32767), true);
    }
    return out;
  }

  function wavFromPcm(pcm, sampleRate) {
    sampleRate = sampleRate || SAMPLE_RATE;
    var out = new Uint8Array(44 + pcm.length), dv = new DataView(out.buffer);
    function str(o, s) { for (var i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); }
    str(0, "RIFF"); dv.setUint32(4, 36 + pcm.length, true); str(8, "WAVE"); str(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, pcm.length, true);
    out.set(pcm, 44);
    return out;
  }
  function floatToWav(samples, sampleRate) { return wavFromPcm(floatToPcm16(samples), sampleRate); }

  function silence(ms, sampleRate) { return new Float32Array(Math.round((ms / 1000) * (sampleRate || SAMPLE_RATE))); }

  function concatFloat(chunks) {
    var total = 0, i;
    for (i = 0; i < chunks.length; i++) total += chunks[i].length;
    var out = new Float32Array(total), o = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], o); o += chunks[i].length; }
    return out;
  }

  var FRAME_MS = 20, ACTIVE_DB = -45;

  function frameRmsDb(samples, sampleRate) {
    var size = Math.round((FRAME_MS / 1000) * (sampleRate || SAMPLE_RATE));
    var n = Math.floor(samples.length / size), out = new Float32Array(n);
    for (var f = 0; f < n; f++) {
      var sum = 0;
      for (var i = f * size; i < (f + 1) * size; i++) sum += samples[i] * samples[i];
      var rms = Math.sqrt(sum / size);
      out[f] = rms > 0 ? 20 * Math.log10(rms) : -120;
    }
    return out;
  }

  /* Trims leading and trailing silence and keeps a small natural margin. */
  function trimSilence(samples, sampleRate, opts) {
    sampleRate = sampleRate || SAMPLE_RATE;
    opts = opts || {};
    var thr = opts.thresholdDb === undefined ? -45 : opts.thresholdDb;
    var keepLead = opts.keepLeadMs === undefined ? 60 : opts.keepLeadMs;
    var keepTail = opts.keepTailMs === undefined ? 120 : opts.keepTailMs;
    var db = frameRmsDb(samples, sampleRate), first = -1, i;
    for (i = 0; i < db.length; i++) { if (db[i] > thr) { first = i; break; } }
    if (first === -1) return samples.slice(0, 0);
    var last = db.length - 1;
    while (last > first && db[last] <= thr) last--;
    var frame = Math.round((FRAME_MS / 1000) * sampleRate);
    var start = Math.max(0, first * frame - Math.round((keepLead / 1000) * sampleRate));
    var end = Math.min(samples.length, (last + 1) * frame + Math.round((keepTail / 1000) * sampleRate));
    return samples.slice(start, end);
  }

  /* ------------------------------------------------------------------ voice QA */

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[idx];
  }
  function semitones(a, b) { return 12 * Math.log2(a / b); }

  /* Fundamental frequency per voiced frame, by normalized autocorrelation. */
  function pitchTrack(samples, sampleRate) {
    sampleRate = sampleRate || SAMPLE_RATE;
    var win = Math.round(0.04 * sampleRate), hop = Math.round(0.02 * sampleRate);
    var minLag = Math.floor(sampleRate / 400), maxLag = Math.ceil(sampleRate / 70), track = [];
    for (var start = 0; start + win + maxLag < samples.length; start += hop) {
      var energy = 0, i;
      for (i = 0; i < win; i++) energy += samples[start + i] * samples[start + i];
      var rmsDb = 20 * Math.log10(Math.sqrt(energy / win) || 1e-6);
      if (rmsDb < -40) continue;
      var bestLag = 0, best = 0;
      for (var lag = minLag; lag <= maxLag; lag++) {
        var sum = 0, e2 = 0;
        for (i = 0; i < win; i++) {
          var b = samples[start + i + lag];
          sum += samples[start + i] * b;
          e2 += b * b;
        }
        var norm = sum / Math.sqrt(energy * e2 || 1);
        if (norm > best) { best = norm; bestLag = lag; }
      }
      if (best > 0.5 && bestLag) track.push({ t: start / sampleRate, f0: sampleRate / bestLag });
    }
    return track;
  }

  function analyze(samples, sampleRate, opts) {
    sampleRate = sampleRate || SAMPLE_RATE;
    var text = (opts && opts.text) || "";
    var durationSec = samples.length / sampleRate, peak = 0, clipped = 0, i;
    for (i = 0; i < samples.length; i++) {
      var a = Math.abs(samples[i]);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
    }
    var db = frameRmsDb(samples, sampleRate), active = [];
    for (i = 0; i < db.length; i++) if (db[i] > ACTIVE_DB) active.push(i);
    var speechSec = (active.length * FRAME_MS) / 1000, power = 0;
    for (i = 0; i < active.length; i++) power += Math.pow(10, db[active[i]] / 10);
    var loudnessDbfs = active.length ? 10 * Math.log10(power / active.length) : -120;

    var track = pitchTrack(samples, sampleRate);
    var f0s = track.map(function (p) { return p.f0; }).sort(function (x, y) { return x - y; });
    var driftSemitones = 0;
    if (track.length >= 20) {
      var mid = track[Math.floor(track.length / 2)].t;
      var A = track.filter(function (p) { return p.t < mid; }).map(function (p) { return p.f0; }).sort(function (x, y) { return x - y; });
      var B = track.filter(function (p) { return p.t >= mid; }).map(function (p) { return p.f0; }).sort(function (x, y) { return x - y; });
      if (A.length >= 8 && B.length >= 8) driftSemitones = Math.abs(semitones(percentile(A, 0.5), percentile(B, 0.5)));
    }
    var letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
    return {
      durationSec: durationSec, speechSec: speechSec, peak: peak,
      clipRatio: samples.length ? clipped / samples.length : 0,
      loudnessDbfs: loudnessDbfs,
      pitchMedianHz: percentile(f0s, 0.5), pitchP10Hz: percentile(f0s, 0.1), pitchP90Hz: percentile(f0s, 0.9),
      voicedFrames: track.length, driftSemitones: driftSemitones,
      lettersPerSec: speechSec > 0 && letters ? letters / speechSec : 0
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function toProfile(m) {
    return {
      pitchMedianHz: round2(m.pitchMedianHz), pitchP10Hz: round2(m.pitchP10Hz), pitchP90Hz: round2(m.pitchP90Hz),
      loudnessDbfs: round2(m.loudnessDbfs), lettersPerSec: round2(m.lettersPerSec),
      durationSec: round2(m.durationSec), voicedFrames: m.voicedFrames
    };
  }

  /* Compares a clip against the golden profile. ctx: { targetDurationSec, text }.
     Resolves to { pass, failures, warnings, metrics }. */
  async function evaluate(samples, golden, ctx, options) {
    ctx = ctx || {}; options = options || {};
    var t = Object.assign({}, DEFAULT_THRESHOLDS, options.thresholds || {});
    var m = analyze(samples, options.sampleRate || SAMPLE_RATE, { text: ctx.text || "" });
    var failures = [], warnings = [];
    function fail(check, detail, extra) { failures.push(Object.assign({ check: check, detail: detail }, extra || {})); }

    if (m.peak < t.minPeak || m.speechSec < t.minSpeechSec) fail("empty_audio", "Clip is silent or almost silent.");
    if (m.clipRatio > t.maxClipRatio) fail("clipping", (m.clipRatio * 100).toFixed(3) + "% of samples are clipped.");
    if (ctx.targetDurationSec && m.durationSec > ctx.targetDurationSec + t.durationToleranceSec) {
      fail("duration_over", "Audio is " + m.durationSec.toFixed(2) + "s but the scene allows " + ctx.targetDurationSec + "s.",
        { options: ["regenerate_at_adjusted_pace", "trim_silence", "split_into_smaller_segments", "extend_scene_timing"] });
    }
    if (golden) {
      if (m.voicedFrames >= t.minVoicedFramesForPitch && golden.voicedFrames >= t.minVoicedFramesForPitch && golden.pitchMedianHz > 0) {
        var d = Math.abs(semitones(m.pitchMedianHz, golden.pitchMedianHz));
        if (d > t.pitchSemitones) fail("pitch_range", "Median pitch " + m.pitchMedianHz.toFixed(0) + "Hz is " + d.toFixed(1) + " semitones from the golden " + golden.pitchMedianHz.toFixed(0) + "Hz.");
      } else warnings.push("Too little voiced audio for a pitch comparison.");
      var dl = Math.abs(m.loudnessDbfs - golden.loudnessDbfs);
      if (m.speechSec >= t.minSpeechSec && dl > t.loudnessDb) fail("loudness", "Loudness differs from golden by " + dl.toFixed(1) + " dB.");
      if (m.speechSec >= t.minSecondsForPace && golden.lettersPerSec > 0 && m.lettersPerSec > 0) {
        var ratio = m.lettersPerSec / golden.lettersPerSec;
        if (Math.abs(ratio - 1) > t.paceRatio) fail("pace", "Pace is " + (ratio * 100).toFixed(0) + "% of the golden reference pace.");
      }
    } else warnings.push("No golden reference profile on this passport. Only absolute checks ran.");

    if (m.speechSec >= t.minSecondsForDrift && m.driftSemitones > t.driftSemitones) {
      fail("tone_shift", "Pitch moves " + m.driftSemitones.toFixed(1) + " semitones within the clip.");
    }
    if (options.speakerSimilarity) {
      var score = await options.speakerSimilarity(samples, golden);
      m.speakerSimilarity = score;
      if (score < t.minSimilarity) fail("speaker_similarity", "Similarity " + score.toFixed(2) + " is below " + t.minSimilarity + ".");
    } else warnings.push("Speaker similarity not checked (no embedding model plugged in).");
    return { pass: failures.length === 0, failures: failures, warnings: warnings, metrics: m };
  }

  /* ------------------------------------------------------------------ text splitting */

  function splitSentences(text) {
    var parts = String(text).match(/[^.!?…]+(?:[.!?…]+["')\]]*)?\s*/g) || [String(text)];
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* Groups sentences into chunks of at most maxChars and never breaks inside a sentence. */
  function chunkForTts(text, maxChars) {
    maxChars = maxChars || 240;
    var chunks = [], current = "";
    splitSentences(text).forEach(function (s) {
      if (current && (current + " " + s).length > maxChars) { chunks.push(current); current = s; }
      else current = current ? current + " " + s : s;
    });
    if (current) chunks.push(current);
    return chunks;
  }

  /* scenes: [{ id, role: "hook"|"body"|"cta", text, durationSec }]. Hook and CTA stay their own
     jobs. Long text splits at sentence boundaries. */
  function buildJobs(scenes, opts) {
    var maxChars = (opts && opts.maxChars) || 240, jobs = [];
    scenes.forEach(function (sc) {
      if (!sc.text || !String(sc.text).trim()) return;
      var role = sc.role === "hook" || sc.role === "cta" ? sc.role : "body";
      var chunks = chunkForTts(sc.text, maxChars);
      var totalChars = chunks.reduce(function (n, c) { return n + c.length; }, 0) || 1;
      var pause = sc.pauseAfterMs !== undefined ? sc.pauseAfterMs : DEFAULT_PAUSE_MS[role];
      chunks.forEach(function (chunk, n) {
        var last = n === chunks.length - 1;
        jobs.push({
          id: chunks.length > 1 ? sc.id + "." + (n + 1) : sc.id,
          sceneId: sc.id, role: role, text: chunk,
          targetDurationSec: sc.durationSec ? Math.round(sc.durationSec * (chunk.length / totalChars) * 100) / 100 : undefined,
          pauseAfterMs: last ? pause : PART_GAP_MS
        });
      });
    });
    return jobs;
  }

  /* ------------------------------------------------------------------ retry + generation */

  /* Retries on 429, 409 and 5xx or network errors (error.retryable) with exponential backoff. */
  async function withRetry(fn, opts) {
    opts = opts || {};
    var max = opts.maxRetries === undefined ? 4 : opts.maxRetries;
    var base = opts.baseDelayMs === undefined ? 500 : opts.baseDelayMs;
    var cap = opts.maxDelayMs || 15000;
    var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var rand = opts.random || Math.random;
    for (var attempt = 0; ; attempt++) {
      try { return await fn(); }
      catch (err) {
        if (!err || !err.retryable || attempt >= max) throw err;
        var delay = Math.min(cap, base * Math.pow(2, attempt)) * (0.5 + rand() * 0.5);
        if (err.retryAfterSec > 0) delay = Math.min(cap, err.retryAfterSec * 1000);
        if (opts.onRetry) opts.onRetry({ attempt: attempt + 1, delayMs: Math.round(delay), error: err });
        await sleep(delay);
      }
    }
  }

  function seedFor(jobId, passportId) {
    var h = checksum(passportId + ":" + jobId);
    return parseInt(h.slice(-8), 16) % 4294967296;
  }

  /* Golden reference clip: the 5 standard lines, extended with 2 more only if the clip would be
     shorter than 20 seconds. tts({voiceId, text, modelId, voiceSettings, seed}) must resolve to
     raw 16-bit PCM at 24 kHz (ArrayBuffer or Uint8Array). */
  async function buildGolden(passport, tts, opts) {
    opts = opts || {};
    var minSec = opts.minSec || 20, maxSec = opts.maxSec || 30, GAP = 450;
    var lines = (opts.lines || GOLDEN_TEST_LINES).slice(), extras = (opts.extraLines || EXTRA_TEST_LINES).slice();
    var clips = [], used = [], warnings = [];
    async function synth(line) {
      var pcm = await tts({ voiceId: passport.elevenlabs_voice_id, text: line, modelId: passport.model_id, voiceSettings: passport.voice_settings, seed: 20260101 + used.length });
      clips.push(trimSilence(pcm16ToFloat(pcm)));
      used.push(line);
      if (opts.onProgress) opts.onProgress({ done: used.length });
    }
    function total() { return clips.reduce(function (n, c) { return n + c.length; }, 0) / SAMPLE_RATE + (Math.max(0, clips.length - 1) * GAP) / 1000; }
    for (var i = 0; i < lines.length; i++) await synth(lines[i]);
    while (total() < minSec && extras.length) await synth(extras.shift());
    if (total() < minSec) warnings.push("Golden clip is " + total().toFixed(1) + "s, under the " + minSec + "s target.");
    if (total() > maxSec) warnings.push("Golden clip is " + total().toFixed(1) + "s, over the " + maxSec + "s target.");
    var parts = [];
    clips.forEach(function (c, k) { parts.push(c); if (k < clips.length - 1) parts.push(silence(GAP)); });
    var samples = concatFloat(parts);
    var profile = toProfile(analyze(samples, SAMPLE_RATE, { text: used.join(" ") }));
    return { samples: samples, wav: floatToWav(samples), profile: profile, durationSec: total(), lines: used, warnings: warnings };
  }

  /* Generates voiceover for a list of jobs (see buildJobs). Every call reads voice, model and
     settings from the passport. Between attempts only the seed changes (and, only when
     allowPaceAdjust is on, a logged speed for scenes that run long). A deleted voice stops the
     run. Nothing is substituted. */
  async function runVoiceover(opts) {
    var passport = opts.passport, jobs = opts.jobs, tts = opts.tts;
    var maxAttempts = opts.maxAttempts || 3, started = Date.now(), results = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var prev = jobs[i - 1] && jobs[i - 1].text, next = jobs[i + 1] && jobs[i + 1].text;
      var baseSeed = seedFor(job.id, passport.character_id);
      var attempts = [], best = null, speed;
      for (var n = 1; n <= maxAttempts; n++) {
        var settings = Object.assign({}, passport.voice_settings);
        if (speed) settings.speed = speed;
        var seed = (baseSeed + n - 1) % 4294967296;
        var pcm = await tts({ voiceId: passport.elevenlabs_voice_id, text: job.text, modelId: passport.model_id, voiceSettings: settings, seed: seed, previousText: prev, nextText: next });
        var samples = trimSilence(pcm16ToFloat(pcm));
        var qa = await evaluate(samples, passport.reference_audio && passport.reference_audio.golden_profile,
          { targetDurationSec: job.targetDurationSec, text: job.text }, { thresholds: opts.thresholds, speakerSimilarity: opts.speakerSimilarity });
        attempts.push({ attempt: n, seed: seed, speed: speed || null, pass: qa.pass, failures: qa.failures.map(function (f) { return f.check; }) });
        if (opts.onProgress) opts.onProgress({ job: job.id, index: i, total: jobs.length, attempt: n, pass: qa.pass, failures: qa.failures });
        if (!best || qa.failures.length < best.qa.failures.length || qa.pass) best = { samples: samples, qa: qa };
        if (qa.pass) break;
        var over = qa.failures.filter(function (f) { return f.check === "duration_over"; })[0];
        if (opts.allowPaceAdjust && over && job.targetDurationSec) {
          speed = Math.min(1.15, Math.max(1.02, Math.round((qa.metrics.durationSec / job.targetDurationSec) * 100) / 100));
        }
      }
      results.push({
        id: job.id, scene_id: job.sceneId, role: job.role, text: job.text,
        character_id: passport.character_id, elevenlabs_voice_id: passport.elevenlabs_voice_id,
        model_id: passport.model_id, voice_settings: passport.voice_settings,
        duration_sec: Math.round(best.qa.metrics.durationSec * 100) / 100,
        pause_after_ms: job.pauseAfterMs, status: best.qa.pass ? "ok" : "needs_review",
        attempts: attempts, qa: { failures: best.qa.failures, warnings: best.qa.warnings },
        samples: best.samples, wav: floatToWav(best.samples)
      });
    }
    var parts = [], cursor = 0, timeline = [];
    results.forEach(function (r) {
      timeline.push({ id: r.id, start_sec: Math.round(cursor * 1000) / 1000, duration_sec: r.duration_sec, status: r.status });
      parts.push(r.samples, silence(r.pause_after_ms));
      cursor += r.duration_sec + r.pause_after_ms / 1000;
    });
    var count = results.length || 1;
    var regenerations = results.reduce(function (n, r) { return n + r.attempts.length - 1; }, 0);
    var firstPass = results.filter(function (r) { return r.attempts[0].pass; }).length;
    var needsReview = results.filter(function (r) { return r.status === "needs_review"; }).length;
    return {
      results: results, timeline: timeline,
      fullWav: floatToWav(concatFloat(parts)),
      ready: needsReview === 0,
      metrics: {
        segments: results.length, locked_voice_usage_pct: 100,
        qa_first_pass_rate: Math.round((firstPass / count) * 1000) / 1000,
        regeneration_rate: Math.round((regenerations / count) * 1000) / 1000,
        needs_review: needsReview, script_to_voiceover_ms: Date.now() - started
      }
    };
  }

  /* Manifest for the renderer or for download. No audio bytes inside. */
  function manifestFor(run, passport) {
    return {
      generated_at: new Date().toISOString(),
      character_id: passport.character_id,
      elevenlabs_voice_id: passport.elevenlabs_voice_id,
      model_id: passport.model_id,
      voice_settings: passport.voice_settings,
      ready_for_renderer: run.ready,
      sample_rate: SAMPLE_RATE,
      full_track: "voiceover_full.wav",
      timeline: run.timeline,
      segments: run.results.map(function (r) {
        return { id: r.id, scene_id: r.scene_id, role: r.role, text: r.text, file: r.id + ".wav", duration_sec: r.duration_sec,
          pause_after_ms: r.pause_after_ms, status: r.status, attempts: r.attempts, qa: r.qa };
      }),
      metrics: run.metrics
    };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION, SAMPLE_RATE: SAMPLE_RATE, DEFAULT_MODEL_ID: DEFAULT_MODEL_ID,
    DEFAULT_VOICE_SETTINGS: DEFAULT_VOICE_SETTINGS, DEFAULT_DELIVERY_RULES: DEFAULT_DELIVERY_RULES,
    VOICE_SOURCES: VOICE_SOURCES, GOLDEN_TEST_LINES: GOLDEN_TEST_LINES, EXTRA_TEST_LINES: EXTRA_TEST_LINES,
    DEFAULT_THRESHOLDS: DEFAULT_THRESHOLDS, DEFAULT_PAUSE_MS: DEFAULT_PAUSE_MS,
    slugify: slugify, checksum: checksum, emptyStore: emptyStore, addVersion: addVersion, verifyStore: verifyStore,
    getActive: getActive, setActive: setActive, attachGolden: attachGolden, validatePassport: validatePassport,
    pcm16ToFloat: pcm16ToFloat, floatToPcm16: floatToPcm16, wavFromPcm: wavFromPcm, floatToWav: floatToWav,
    trimSilence: trimSilence, silence: silence, concatFloat: concatFloat,
    analyze: analyze, toProfile: toProfile, evaluate: evaluate, pitchTrack: pitchTrack,
    splitSentences: splitSentences, chunkForTts: chunkForTts, buildJobs: buildJobs,
    withRetry: withRetry, buildGolden: buildGolden, runVoiceover: runVoiceover, manifestFor: manifestFor
  };
});
