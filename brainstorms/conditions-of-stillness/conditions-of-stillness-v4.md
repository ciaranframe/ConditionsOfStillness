# Conditions of Stillness — AirStick system — v4

## Quick Context
Sub-project 4 (the generic `airkit-patch` skill, the piece profile, the patching tools, the mined
corpus and its digest, the samples workflow) planned, built with subagent-driven development,
reviewed and merged on 2026-09-27, in the same autonomous run as sub-project 3. Next: the first
patches, which need Ciaran's `patching/context/` material and per-scene briefs.

## Session Log
| Date | Duration | Energy | Mode | Methods |
|---|---|---|---|---|
| 2026-09-27 (cont.) | long | build | connected | writing-plans; subagent-driven development (10 tasks, per-task reviews, two tasks built in isolated worktrees in parallel, one final review + one fix wave); real-engine gate on the template |

## Decisions Made (rulings, Ciaran away)
- Tools live in `patching/tools/` (own package, `yaml` only, ffmpeg via CLI); the root `npm test` runs their tests.
- Corpus mining is git-object-only over five branches, deduplicated by blob, deterministic, recording the mined commit per branch; `digest.md` is prose written from the index (100 checked pointers).
- The audition tool uses a private device on slot 9's bus (source port 9101 → device 9109) so it never touches the runner's slots; it runs against a live engine or boots a private one; `--rest-max` lets a patch that is designed to sound at rest pass.
- Takes: `takes/<label>.take.jsonl` (header + `{t,a,q}` rows) recorded on udp 8001 by repointing one stick, or on 8000 with the runner stopped.
- Compile check = Glimmer's headless-sclang idiom (no compile-only flag exists), now a TypeScript CLI.
- Lint = Glimmer's rules re-parameterised by `patching/profile.md`'s front-matter plus COS rules (header keys, `2H` ⇔ uses `~partner`, scene-params hook, partner nil-guard, samples through `~cosSamples`, `cos*` SynthDef prefix); a `.tmp` lints as its final name.
- Samples: `SHOPPING.md` table → `samples-check` → `manifest.json` merged across runs; a same-slot extra file is a warning, an unmatched file fails.
- Roster edits via `patch-roster`; SKILL.md commits and pushes the AirKit branch only after `AUDITION PASS`; never rebase/force.
- No patch was written; the gate is `COS_Template` (lint, compile, audition) and a research-only dry run (`patching/notes/EXAMPLE.md`).

## Current Thinking
- The skill is usable from a fresh session: profile + context → six-track research → note → atomic patch write → compile → lint → roster → audition → (samples) → commit/push → hand-off.
- Known limits: a `2H` patch auditions with no partner; the private audition device persists in the engine; running the audition beside a live runner is untested on hardware.

## Open Questions
- Footswitch; performance laptop; `patching/context/` material; wrist takes (needed before real auditions mean much).

## Next Steps
1. Ciaran: write `patching/context/` (programme note, per-scene notes), record takes, choose the footswitch.
2. First patches with `/airkit-patch <brief>`; first rehearsal per `docs/rehearsal-checklist.md`.
