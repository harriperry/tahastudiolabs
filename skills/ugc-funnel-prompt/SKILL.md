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

## After any change
Run `node --test tests/ugc-funnel.test.mjs`. All tests must pass before committing.
