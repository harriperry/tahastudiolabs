---
name: ugc-funnel-prompt
description: Write or revise the master prompt for ScriptForge's AI UGC Funnel (direct-response UGC kits with strict timed scenes, hooks, body and CTAs). Use when the funnel's rules, lengths, archetypes or compliance scans need changing.
---

# UGC funnel master prompt

The funnel's rules live in one file: `assets/ugc/funnel.spec.json`. The prompt sent to the model is assembled from it by `assets/ugc-funnel-core.js`. Edit the spec, never the generated prompt.

## What the spec controls
- `lengths`: scenes per video length (12, 15 and 30 seconds), with start, end and word range. Scenes must tile 0 to the full length with no gaps, and every scene is one clip of at most `limits.maxSceneSeconds` (10), because most video generators stop at 10 seconds.
- `archetypes`, `tones`, `categories` (strict or standard compliance profile, with example `pivots`), and `overlap` (the hook versus problem repetition check).
- `shots`: allowed types, 2 or 3 second shots, text_pop maximum 5 words, types blocked for strict categories.
- `scans`: regex checks for medical, fear, hype and proof wording. A word the user typed in the brief becomes a warning, not a failure.
- `prompt`: the text blocks. Placeholders look like {{language}}.
- `wordFactor`: per language multiplier, keep at 1 until a real TTS test shows how many words fit.

## Hard rules to keep
1. No em dashes or en dashes anywhere, in the spec, the prompt or the output.
2. Word counts, shot timing and claims are validated in code. Never ask the model to count.
3. One kit call returns 3 hooks, 1 body and 2 CTAs. Only a failing scene is regenerated, at most twice.
4. Strict categories: no before_after shots, no curative wording. Every category: no first person in the SOLUTION, no speed promises (instantly, in seconds), product features come only from the details field (and the SOLUTION must show one), no ease claims (effortless, zero effort), and a hook never repeats the problem's key words.
5. Never invent numbers, reviews, awards or results.
6. Generators never draw readable text, app screens, documents, logos, clocks or keyboards. The `render` scan in the spec blocks those words in shots an image or video model will draw. For apps and AI tools, `screen_recording` and `ui_zoom` are real footage (`shots.appRealFootageTypes`), shown in the pack as REAL FOOTAGE NEEDED lines and never turned into T2I or I2V prompts.
7. Every T2I and I2V line, and the T2I list, ends with the negative block from `pack.t2iSuffix` and `pack.i2vTemplate` (no readable or gibberish text, no UI, no player controls, no watermark, no split screen, no stacked frames, no collage, no extra people, no face change). Edit it in the spec only.
8. Every production pack ends with POST NOTES from `pack.postNotes`: burned in captions, a brand tag, a designed end card (never a black last frame), one presenter in every scene, 1080x1920 export and a check before posting. Captions, brand tag and end card are added in editing, never generated.
9. Every b_roll shot must have a job (the pain, the product in use or the result). No filler shots.
10. When a new glitch class shows up in a finished video, add a rule and a test here for the class, not only a fix for that one video. The full standard lives in the `ugc-production-standard` Claude skill.

## After any change
Run `node --test tests/ugc-funnel.test.mjs`. All tests must pass before committing.
