// Tests for the Voice Passport core and the ElevenLabs relays.
// Run with: node --test tests/voice-passport.test.mjs
// No network. ElevenLabs is replaced by small mocks.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const VP = require("../assets/voice-passport-core.js");
const { onRequestPost: ttsRelay, buildUpstreamBody } = await import("../functions/api/elevenlabs-tts.js");
const { onRequestPost: designRelay } = await import("../functions/api/elevenlabs-design.js");
const { onRequestPost: saveRelay } = await import("../functions/api/elevenlabs-voice-save.js");
const { onRequestPost: cloneRelay } = await import("../functions/api/elevenlabs-clone.js");

const SR = 24000;

/* A synthetic "voice": harmonic tone with a syllable-like envelope. */
function fakeVoice({ seconds, f0 = 200, amp = 0.3, lead = 0.2, tail = 0.3 }) {
  const n = Math.round((seconds + lead + tail) * SR);
  const out = new Float32Array(n);
  const s0 = Math.round(lead * SR), s1 = n - Math.round(tail * SR);
  for (let i = s0; i < s1; i++) {
    const t = i / SR;
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3.5 * t) ** 2;
    let v = 0;
    for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f0 * h * t) / h;
    out[i] = amp * env * v * 0.6;
  }
  return out;
}
const pcmOf = (f) => VP.floatToPcm16(f);

function mockTts({ f0 = 200, charsPerSec = 14, behave } = {}) {
  const calls = [];
  const tts = async (args) => {
    calls.push(args);
    const override = behave ? behave(args, calls.length) : {};
    return pcmOf(fakeVoice({ seconds: Math.max(0.6, args.text.length / charsPerSec), f0, ...override }));
  };
  tts.calls = calls;
  return tts;
}

const input = (over = {}) => ({ characterName: "Liam", voiceId: "voice_liam", voiceSource: "library", ...over });

/* ---------------------------------------------------------------- passport store */

test("first voice becomes v1 with locked defaults", () => {
  const { store, passport } = VP.addVersion(VP.emptyStore(), input());
  assert.equal(passport.character_id, "liam_ugc_v1");
  assert.equal(passport.model_id, "eleven_multilingual_v2");
  assert.deepEqual(passport.voice_settings, { stability: 0.7, similarity_boost: 0.85, style: 0.1 });
  assert.equal(store.active, "liam_ugc_v1");
  assert.ok(VP.verifyStore(store).ok);
});

test("a new voice adds v2 and keeps v1 exactly as it was", () => {
  const a = VP.addVersion(VP.emptyStore(), input());
  const before = JSON.stringify(a.store.versions.liam_ugc_v1);
  const b = VP.addVersion(a.store, input({ voiceId: "voice_two", voiceSource: "design" }));
  assert.equal(b.passport.character_id, "liam_ugc_v2");
  const v1 = b.store.versions.liam_ugc_v1;
  assert.equal(v1.elevenlabs_voice_id, "voice_liam");
  assert.equal(v1.status, "superseded");
  assert.equal(JSON.stringify({ ...v1, status: "active" }), before);
  assert.equal(VP.getActive(b.store).character_id, "liam_ugc_v2");
});

test("the input store is never mutated", () => {
  const a = VP.addVersion(VP.emptyStore(), input());
  const snapshot = JSON.stringify(a.store);
  VP.addVersion(a.store, input({ voiceId: "x" }));
  assert.equal(JSON.stringify(a.store), snapshot);
});

test("editing a locked field is detected", () => {
  const { store } = VP.addVersion(VP.emptyStore(), input());
  store.versions.liam_ugc_v1.elevenlabs_voice_id = "voice_sneaky";
  const r = VP.verifyStore(store);
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /liam_ugc_v1/);
});

test("rollback and golden attach keep the lock valid", () => {
  const a = VP.addVersion(VP.emptyStore(), input());
  const b = VP.addVersion(a.store, input({ voiceId: "v2" }));
  let s = VP.setActive(b.store, "liam_ugc_v1");
  assert.equal(VP.getActive(s).character_id, "liam_ugc_v1");
  s = VP.attachGolden(s, "liam_ugc_v1", { profile: { pitchMedianHz: 120 }, lines: ["a"] });
  assert.equal(VP.getActive(s).reference_audio.golden_profile.pitchMedianHz, 120);
  assert.ok(VP.verifyStore(s).ok);
  assert.equal(Object.keys(s.versions).length, 2);
});

test("bad settings and empty names are rejected", () => {
  assert.throws(() => VP.addVersion(VP.emptyStore(), input({ voiceSettings: { stability: 3 } })), /stability/);
  assert.throws(() => VP.addVersion(VP.emptyStore(), input({ characterName: "!!!" })), /letters or digits/);
  assert.throws(() => VP.addVersion(VP.emptyStore(), input({ voiceId: "" })), /elevenlabs_voice_id/);
});

test("golden lines contain no em dashes", () => {
  for (const l of [...VP.GOLDEN_TEST_LINES, ...VP.EXTRA_TEST_LINES]) assert.ok(!l.includes(String.fromCharCode(0x2014)), l);
});

/* ---------------------------------------------------------------- audio + QA */

test("wav header and pcm round trip", () => {
  const f = fakeVoice({ seconds: 0.5 });
  const wav = VP.floatToWav(f);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(wav.length, 44 + f.length * 2);
  const back = VP.pcm16ToFloat(wav.slice(44));
  assert.ok(Math.abs(back[5000] - f[5000]) < 0.001);
});

test("trimSilence removes lead and tail but keeps speech", () => {
  const f = fakeVoice({ seconds: 1, lead: 0.5, tail: 0.5 });
  const t = VP.trimSilence(f);
  assert.ok(t.length < f.length * 0.65 && t.length > SR * 0.9);
});

test("qa passes the same voice and flags pitch, loudness, silence and similarity", async () => {
  const good = VP.trimSilence(fakeVoice({ seconds: 3, f0: 200 }));
  const golden = VP.toProfile(VP.analyze(good, SR, { text: "x".repeat(42) }));
  assert.ok(Math.abs(golden.pitchMedianHz - 200) < 8);
  const text = "x".repeat(42);
  assert.equal((await VP.evaluate(good, golden, { text })).pass, true);
  const high = await VP.evaluate(VP.trimSilence(fakeVoice({ seconds: 3, f0: 300 })), golden, { text });
  assert.ok(high.failures.some((f) => f.check === "pitch_range"));
  const loud = await VP.evaluate(VP.trimSilence(fakeVoice({ seconds: 3, amp: 0.9 })), golden, { text });
  assert.ok(loud.failures.some((f) => f.check === "loudness" || f.check === "clipping"));
  const none = await VP.evaluate(new Float32Array(SR), golden, { text });
  assert.ok(none.failures.some((f) => f.check === "empty_audio"));
  const sim = await VP.evaluate(good, golden, { text }, { speakerSimilarity: async () => 0.4 });
  assert.ok(sim.failures.some((f) => f.check === "speaker_similarity"));
});

test("natural intonation inside a short clip is not flagged as a tone shift", async () => {
  // rising pitch over 3 seconds, like a question: well under the 5 second drift check
  const n = SR * 3, f = new Float32Array(n);
  for (let i = 0; i < n; i++) { const hz = 150 * (1 + 0.5 * i / n); f[i] = 0.3 * Math.sin(2 * Math.PI * hz * i / SR); }
  const golden = VP.toProfile(VP.analyze(VP.trimSilence(fakeVoice({ seconds: 3, f0: 190 })), SR, { text: "x".repeat(42) }));
  const r = await VP.evaluate(f, golden, { text: "x".repeat(42) });
  assert.ok(!r.failures.some((x) => x.check === "tone_shift"));
});

/* ---------------------------------------------------------------- jobs */

test("hook and cta stay separate, long text splits at sentences, empty scenes are skipped", () => {
  const long = "First sentence is here. ".repeat(20);
  const jobs = VP.buildJobs([
    { id: "hook", role: "hook", text: "Hook line.", durationSec: 3 },
    { id: "problem", role: "body", text: long, durationSec: 10 },
    { id: "broll", role: "body", text: "" },
    { id: "cta", role: "cta", text: "Follow me.", durationSec: 3 }
  ]);
  assert.equal(jobs[0].id, "hook");
  assert.ok(jobs.filter((j) => j.sceneId === "problem").length > 1);
  assert.ok(!jobs.some((j) => j.sceneId === "broll"));
  assert.equal(jobs.at(-1).pauseAfterMs, 0);
  assert.ok(VP.chunkForTts(long, 240).every((c) => c.length <= 260));
});

/* ---------------------------------------------------------------- golden + run */

test("golden clip is 20 to 30 seconds with a profile", async () => {
  const { passport } = VP.addVersion(VP.emptyStore(), input());
  const g = await VP.buildGolden(passport, mockTts());
  assert.ok(g.durationSec >= 18 && g.durationSec <= 32, String(g.durationSec));
  assert.ok(Math.abs(g.profile.pitchMedianHz - 200) < 10);
  assert.equal(g.wav.length, 44 + g.samples.length * 2);
});

async function lockedPassport() {
  const { passport } = VP.addVersion(VP.emptyStore(), input());
  const g = await VP.buildGolden(passport, mockTts());
  const store = VP.attachGolden(VP.addVersion(VP.emptyStore(), input()).store, "liam_ugc_v1", { profile: g.profile, lines: g.lines });
  return VP.getActive(store);
}
const SCENES = [
  { id: "hook", role: "hook", text: "Okay, be honest. How many drafts are stuck?", durationSec: 6 },
  { id: "problem", role: "body", text: "I open the camera, stare, then close it. Some days I just sit there, completely stuck.", durationSec: 10 },
  { id: "cta", role: "cta", text: "Follow for more creator tips, and save this for later.", durationSec: 6 }
];

test("every call uses the passport voice, model and settings", async () => {
  const passport = await lockedPassport();
  const tts = mockTts();
  const run = await VP.runVoiceover({ passport, jobs: VP.buildJobs(SCENES), tts });
  for (const c of tts.calls) {
    assert.equal(c.voiceId, "voice_liam");
    assert.equal(c.modelId, passport.model_id);
    assert.deepEqual(c.voiceSettings, passport.voice_settings);
  }
  assert.equal(run.ready, true);
  assert.equal(run.metrics.qa_first_pass_rate, 1);
  assert.equal(run.timeline.length, 3);
  assert.equal(VP.manifestFor(run, passport).segments[0].file, "hook.wav");
});

test("a failing clip is regenerated with the same voice and a different seed", async () => {
  const passport = await lockedPassport();
  const seen = new Set();
  const tts = mockTts({ behave: (a) => { const first = !seen.has(a.text); seen.add(a.text); return first ? { amp: 0.003 } : {}; } });
  const run = await VP.runVoiceover({ passport, jobs: VP.buildJobs(SCENES), tts });
  assert.ok(run.metrics.regeneration_rate > 0);
  const by = {};
  for (const c of tts.calls) (by[c.text] ||= []).push(c);
  for (const calls of Object.values(by)) {
    assert.equal(new Set(calls.map((c) => c.voiceId)).size, 1);
    assert.equal(new Set(calls.map((c) => JSON.stringify(c.voiceSettings))).size, 1);
    assert.equal(new Set(calls.map((c) => c.seed)).size, calls.length);
  }
});

test("repeated failure flags manual review and the run is not ready", async () => {
  const passport = await lockedPassport();
  const run = await VP.runVoiceover({ passport, jobs: VP.buildJobs(SCENES), tts: mockTts({ behave: () => ({ amp: 0.003 }) }), maxAttempts: 2 });
  assert.equal(run.ready, false);
  assert.ok(run.results.every((r) => r.status === "needs_review" && r.attempts.length === 2));
});

test("a deleted voice stops the run", async () => {
  const passport = await lockedPassport();
  const tts = async () => { const e = new Error("gone"); e.name = "VoiceNotFound"; throw e; };
  await assert.rejects(() => VP.runVoiceover({ passport, jobs: VP.buildJobs(SCENES), tts }), /gone/);
});

test("pace adjust is off by default and logged when on", async () => {
  const passport = await lockedPassport();
  const jobs = VP.buildJobs([{ id: "x", role: "body", text: "I open the camera, stare, then close it again.", durationSec: 1.5 }]);
  const off = await VP.runVoiceover({ passport, jobs, tts: mockTts(), maxAttempts: 2 });
  assert.equal(off.results[0].status, "needs_review");
  assert.ok(off.results[0].qa.failures.some((f) => f.check === "duration_over" && f.options.includes("split_into_smaller_segments")));
  assert.ok(off.results[0].attempts.every((a) => a.speed === null));
  const on = await VP.runVoiceover({ passport, jobs, tts: mockTts(), maxAttempts: 2, allowPaceAdjust: true });
  assert.ok(on.results[0].attempts[1].speed > 1);
});

/* ---------------------------------------------------------------- retry */

test("withRetry backs off on retryable errors and stops on others", async () => {
  const delays = [];
  let n = 0;
  const flaky = async () => { n++; if (n < 3) { const e = new Error("busy"); e.retryable = true; throw e; } return "ok"; };
  assert.equal(await VP.withRetry(flaky, { sleep: async (ms) => delays.push(ms), random: () => 1 }), "ok");
  assert.deepEqual(delays, [500, 1000]);
  let m = 0;
  await assert.rejects(() => VP.withRetry(async () => { m++; throw new Error("bad"); }, { sleep: async () => {} }), /bad/);
  assert.equal(m, 1);
  const ra = [];
  let k = 0;
  await VP.withRetry(async () => { k++; if (k < 2) { const e = new Error("rate"); e.retryable = true; e.retryAfterSec = 3; throw e; } return 1; }, { sleep: async (ms) => ra.push(ms) });
  assert.deepEqual(ra, [3000]);
});

/* ---------------------------------------------------------------- relays */

function jsonReq(body) { return new Request("https://x.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
function withFetch(handler, fn) {
  const real = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return handler(url, init); };
  return Promise.resolve(fn(calls)).finally(() => { globalThis.fetch = real; });
}

test("tts relay is backward compatible: old body gives the old upstream call", async () => {
  await withFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }), async (calls) => {
    const res = await ttsRelay({ request: jsonReq({ apiKey: "k", voiceId: "v1", text: "Hi" }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "audio/mpeg");
    assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/text-to-speech/v1");
    assert.deepEqual(JSON.parse(calls[0].init.body), { text: "Hi", model_id: "eleven_multilingual_v2" });
    assert.equal(calls[0].init.headers["xi-api-key"], "k");
  });
});

test("tts relay passes passport settings, seed, context and pcm format", async () => {
  await withFetch(() => new Response(new Uint8Array([1, 2]), { status: 200, headers: { "Content-Type": "audio/pcm" } }), async (calls) => {
    const res = await ttsRelay({ request: jsonReq({ apiKey: "k", voiceId: "v1", text: "Hi", modelId: "eleven_flash_v2_5", outputFormat: "pcm_24000", seed: 42, previousText: "Before.", nextText: "After.", voiceSettings: { stability: 0.7, similarity_boost: 0.85, style: 0.1, speed: 1.05 } }) });
    assert.equal(res.headers.get("Content-Type"), "application/octet-stream");
    assert.match(calls[0].url, /\/v1\/text-to-speech\/v1\?output_format=pcm_24000$/);
    const b = JSON.parse(calls[0].init.body);
    assert.equal(b.model_id, "eleven_flash_v2_5");
    assert.deepEqual(b.voice_settings, { stability: 0.7, similarity_boost: 0.85, style: 0.1, speed: 1.05 });
    assert.equal(b.seed, 42);
    assert.equal(b.previous_text, "Before.");
    assert.equal(b.next_text, "After.");
  });
});

test("tts relay sanitizes: bad model, bad format and out of range values", () => {
  const b = buildUpstreamBody({ text: "t", modelId: "evil/../x", voiceSettings: { stability: 9, speed: 5, style: "no" }, seed: -1 });
  assert.equal(b.model_id, "eleven_multilingual_v2");
  assert.deepEqual(b.voice_settings, { stability: 1, speed: 1.2 });
  assert.equal(b.seed, undefined);
});

test("tts relay forwards errors and Retry-After", async () => {
  await withFetch(() => new Response(JSON.stringify({ detail: { status: "too_many", message: "slow down" } }), { status: 429, headers: { "Retry-After": "2", "Content-Type": "application/json" } }), async () => {
    const res = await ttsRelay({ request: jsonReq({ apiKey: "k", voiceId: "v", text: "t" }) });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("Retry-After"), "2");
    assert.equal((await res.json()).error.message, "slow down");
  });
});

test("tts relay validates input", async () => {
  assert.equal((await ttsRelay({ request: jsonReq({ voiceId: "v", text: "t" }) })).status, 400);
  assert.equal((await ttsRelay({ request: jsonReq({ apiKey: "k", text: "t" }) })).status, 400);
  assert.equal((await ttsRelay({ request: jsonReq({ apiKey: "k", voiceId: "v" }) })).status, 400);
});

test("design relay returns candidates and rejects short descriptions", async () => {
  assert.equal((await designRelay({ request: jsonReq({ apiKey: "k", description: "short" }) })).status, 400);
  await withFetch(() => new Response(JSON.stringify({ text: "sample", previews: [{ generated_voice_id: "g1", audio_base_64: "AAAA", media_type: "audio/mpeg", duration_secs: 4 }] }), { status: 200 }), async (calls) => {
    const res = await designRelay({ request: jsonReq({ apiKey: "k", description: "Late twenties, warm, relaxed, slightly breathy UGC creator voice" }) });
    const data = await res.json();
    assert.equal(data.previews[0].generated_voice_id, "g1");
    assert.match(calls[0].url, /\/v1\/text-to-voice\/design\?output_format=mp3_44100_128$/);
    assert.equal(JSON.parse(calls[0].init.body).auto_generate_text, true);
  });
});

test("design relay surfaces a missing permission message", async () => {
  await withFetch(() => new Response(JSON.stringify({ detail: { status: "missing_permissions", message: "The API key is missing the permission text_to_voice" } }), { status: 401 }), async () => {
    const res = await designRelay({ request: jsonReq({ apiKey: "k", description: "Late twenties, warm, relaxed, slightly breathy UGC creator voice" }) });
    assert.equal(res.status, 401);
    assert.match((await res.json()).error.message, /text_to_voice/);
  });
});

test("voice save relay returns the permanent voice id", async () => {
  await withFetch(() => new Response(JSON.stringify({ voice_id: "perm1" }), { status: 200 }), async (calls) => {
    const res = await saveRelay({ request: jsonReq({ apiKey: "k", generatedVoiceId: "g1", name: "Liam", description: "A warm creator voice for UGC videos" }) });
    assert.equal((await res.json()).voice_id, "perm1");
    const b = JSON.parse(calls[0].init.body);
    assert.equal(b.generated_voice_id, "g1");
    assert.equal(b.voice_name, "Liam");
  });
  assert.equal((await saveRelay({ request: jsonReq({ apiKey: "k", name: "x" }) })).status, 400);
});

test("clone relay forwards samples and enforces limits", async () => {
  const mk = (n, size = 10) => { const f = new FormData(); f.set("apiKey", "k"); f.set("name", "Me"); for (let i = 0; i < n; i++) f.append("files", new File([new Uint8Array(size)], `s${i}.wav`, { type: "audio/wav" })); return new Request("https://x.test/api", { method: "POST", body: f }); };
  await withFetch(() => new Response(JSON.stringify({ voice_id: "clone1", requires_verification: false }), { status: 200 }), async (calls) => {
    const res = await cloneRelay({ request: mk(2) });
    assert.equal((await res.json()).voice_id, "clone1");
    assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/voices/add");
    assert.equal(calls[0].init.headers["xi-api-key"], "k");
    assert.equal(calls[0].init.body.getAll("files").length, 2);
  });
  assert.equal((await cloneRelay({ request: mk(0) })).status, 400);
  assert.equal((await cloneRelay({ request: mk(6) })).status, 400);
  assert.equal((await cloneRelay({ request: mk(1, 21 * 1024 * 1024) })).status, 413);
});
