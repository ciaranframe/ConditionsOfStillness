---
name: airkit-patch
description: Research, write, check and audition an AirKit personality (a SuperCollider patch driven by a wrist-worn AirStick) for a piece, driven by that piece's profile (default patching/profile.md). Use for "write a patch", "new sound for scene X", "make a sound for the left hand…", "audition this patch", "iterate on COS_<Name>", or "/airkit-patch <brief>".
---

# /airkit-patch — research, write, check and audition a patch

Invocation: `/airkit-patch <brief> [--profile patching/profile.md]`. The brief is everything
after the command (or the user's description). You are making one **AirKit personality**: a
SuperCollider `.sc` file that turns the motion of one performer's wrist (or two, for a `2H`
patch) into sound, inside the engine on the `AirConditions` branch. The skill is generic; every
piece-specific fact — names, prefixes, roster, template, level plan, hand-off format — comes
from the **profile**. Follow the steps in order. **STOP** means stop and wait for Ciaran.

| what | where (this repo; all from the profile) |
|---|---|
| profile | `patching/profile.md` (front-matter: `prefix`, `synthdefPrefix`, `roster`, `personalities`, `template`, `headerKeys`, `gestureWords`, `samplesVar`) |
| piece context | `patching/context/` — every file, in full |
| research note | `patching/notes/COS_<Name>.md` from `assets/note-template.md`; worked example `patching/notes/EXAMPLE.md` |
| patch | `airkit/personalities/COS_<Name>.sc` (the `airkit/` worktree, branch `AirConditions`) |
| template | `airkit/personalities/COS_Template.sc` (a pointer — copy from it, never edit it) |
| roster | `airkit/lists/list_conditions.sc` — edit only with `npm run patch:roster` |
| corpus | `patching/corpus/{digest.md,index.json,INDEX.md}`; raw files in the main checkout only |
| samples | `samples/COS_<Name>/` (`SHOPPING.md`, `manifest.json`, `SOURCES.md`; audio gitignored) |
| takes | `takes/<label>.take.jsonl`, listed in `takes/INDEX.md` |
| tools | root `package.json` scripts; details in `patching/tools/README.md` |

References, read as each step says: `references/engine.md` (the contract: lifecycle, hooks,
`[COS]` additions, gesture model, what a patch must never do), `references/patterns.md`
(idioms with code), `references/pitfalls.md` (every trap that has cost live time),
`references/research.md` (the six tracks and the subagent brief), `references/samples.md`,
`references/profile-schema.md`. **Engine facts win**: where a reference, the profile, the corpus
or a subagent disagrees with the engine source in `airkit/code3.0/`, follow the engine and say
so in the note.

## Steps

**0. Read the ground.** Read the profile named by `--profile` (default `patching/profile.md`)
and **every file in `patching/context/` in full** — the scene notes shape the sound more than
the brief does. Then read `references/engine.md` and `references/pitfalls.md` in full, and
`references/research.md`. Skim `patterns.md` for the idiom list; read your idiom properly at
step 3. If this is an iteration on an existing patch, read its note and its file, go to the
step the feedback touches, and log it in the note's iteration log.

**1. Read the brief like a composer** (`research.md` §0). What is the gesture — which wrist,
which performer, playing or free gesture, one hand or `2H`? What does the room hear — referent,
foreground or halo, against an acoustic piano and bass drum that must still be heard? What is
the ensemble doing in that scene (from the context)? What sounds at rest? Pick the name
`COS_<UpperCamel>` (`2H` suffix only if it reads `~partner`), not already in
`airkit/personalities/`. Ask Ciaran only when two readings lead to different instruments;
otherwise decide and mark each decision **Assumption:** in the note.

**2. Research — six tracks in parallel subagents** (`research.md` §1–2). One `general-purpose`
subagent per track, **all six dispatched in one message**: A physics, B synthesis prior art,
C musical world (against an equal-tempered piano and an unpitched drum), D gesture and mapping,
E SuperCollider practice (UGens verified against local help; CPU for eight live copies), F the
corpus (queries `patching/corpus/index.json` and reads `patching/corpus/digest.md`, then the
2–5 closest raw files in full). Subagents cannot see these files: paste the brief, a context
summary, the track's questions, the constraints block and the return format from
`research.md` into each prompt, using its brief template. Spot-check the two or three numbers
the design leans on hardest by opening the source yourself. Do not shorten this step because a
plausible patch could be written from memory.

**3. Design, then write the note** (`research.md` §3–4). Write `patching/notes/COS_<Name>.md`
from `assets/note-template.md` **before** the patch: findings per track with sources, technique
and why, parameters traced to findings, pitch world, the mapping table (performer terms first,
then model fields), rest behaviour and one reveal, `2H` roles, standby/exit, level and CPU plan,
params, samples. Read the chosen idiom in `patterns.md` properly and one or two corpus files of
the same shape. Verify every UGen and argument list against the local help before using it.

**4. Write the patch atomically.** Copy `airkit/personalities/COS_Template.sc` to
`airkit/personalities/COS_<Name>.sc.tmp` and edit **only the `.tmp`**. The engine hot-loads on
mtime and interprets whatever is on disk — a partial `.sc` must never exist. Header first, from
`assets/header-template.txt` (the profile's `headerKeys`, `gestures:` from its `gestureWords`),
then the body. Keep the template's load-bearing idioms: compose `~init`/`~deinit`, release by
`gate` not `.free`, guard `synth.notNil` in the tick, read params in both `~init` and
`~onSceneParams`, alias the four state ticks to `~idleNext`, handle `\silent`. SynthDefs
`\cos<Name><Part>`; `Pdef`/event types keyed with `m.ptn`; every gesture-derived control
clamped; a ceiling on the output. Comment the *why* and the source of each researched number
(`// decay 0.28 s: note §3A-4`) and every corpus logic borrowed (`// after patching/corpus/…:line`).
Parse-check the tmp, then move it into place:
```
npm run patch:compile -- airkit/personalities/COS_<Name>.sc.tmp
mv airkit/personalities/COS_<Name>.sc.tmp airkit/personalities/COS_<Name>.sc
```
Every later edit the same way: edit the `.tmp` copy, check, `mv` over.

**5. Compile check** of the installed file: `npm run patch:compile -- COS_<Name>` → `parses`.
A headless throwaway sclang on 57190 (~3 s); it never executes the patch. The classic failure:
a top-level `var` after the first statement.

**6. Lint** until 0 errors: `npm run patch:lint -- COS_<Name>`. Read every warning; the
`roster` warning goes away at step 7. Fix the patch (via the `.tmp`, step 4), never the rule.

**7. Roster and commit the AirKit branch.**
```
npm run patch:roster -- add COS_<Name>
git -C airkit add personalities/COS_<Name>.sc lists/list_conditions.sc
git -C airkit commit -m "cos: COS_<Name> — <one-line sound>"
git -C airkit push mirror AirConditions
```
then set `sha=` in `airkit.lock` to `git -C airkit rev-parse HEAD` and commit the note and the
lock in the piece repo (`./setup.sh --check` should say `airkit-lock: match`). Additive only;
never push to `origin`; never touch `~/AirKit`.

**8. Audition** on slot 9: `npm run patch:audition -- COS_<Name>` (synthetic phases rest, tilt,
sway, shake, strike, still, settle); `--take <label>` when a take in `takes/INDEX.md` fits the
brief; `--params k=v,…` to hear a scene's params; `--quick` while fixing, the full run before
hand-off; `--long` to check a 60 s unheard preload. It uses the running engine on 57120 if one
answers, else boots a private one on 57130/57131 — it plays through the real output, so **tell
Ciaran first** if he is mid-session. Report the table verbatim. Iterate 4–8 until `AUDITION
PASS` and the numbers match the intent: the designed rest sound at rest, audible from a gentle
sway, peaks around −12…−6 dBFS shaken hard, silent within a second of the unload, no errors.
Calibrate, don't guess: thresholds are only as good as your idea of the gesture's scale — use a
take, or a debug copy that posts key values once a second (never the clean file).

**9. Samples**, only if the header declares `samples:` slots (`references/samples.md`). Write
`samples/COS_<Name>/SHOPPING.md` from `assets/shopping-template.md` (the table is machine-read:
keep its header row), commit it, and **STOP**: tell Ciaran what to download and the filename
rule (`<slot>-anything.ext`). When he says the files are in, run
`npm run samples:check -- COS_<Name>` until it exits 0, commit `manifest.json` and `SOURCES.md`
(ask him to fill in URL/author/licence), then audition again. Never download audio yourself;
CC0 / CC-BY / own recordings only.

**10. Hand off** in the profile's format, one short message, then **STOP**:
- the name, that it is in the roster, and the commit/mirror state;
- what it is, for a performer, in one sentence;
- three or four gestures in **piano and drum terms** (a rolled chord, a tremolo, a soft mallet
  stroke, a hand damping the head, a still hand) and what each should do;
- what to listen for at rest, gently, hard, and the reveal;
- the scene params worth trying (`key=value` → expected change);
- the audition table; open questions; the two or three findings that most shaped it, linked.
Fill the note's §6 with the same.

**11. Iterate on Ciaran's notes.** Feedback → edit the `.tmp` → compile → `mv` → lint →
audition → note's iteration log → commit AirKit and push mirror → lock → report → stop. A
loaded patch hot-reloads on save; nothing needs restarting. Tune by ear with him rather than
arguing from the research.

## Definition of done

- [ ] Profile and every `patching/context/` file read; the note says what shaped the patch.
- [ ] Six research tracks returned and cited; key numbers spot-checked; web tracks list sources opened.
- [ ] `patching/notes/COS_<Name>.md` complete (findings, design, mapping, params, hand-off, sources) and true of the final patch.
- [ ] Header true of the finished patch: every profile key, `gestures:` from the vocabulary, `params:` and `samples:` match the code.
- [ ] Written only via `.tmp` + `mv`; `patch:compile` parses; `patch:lint` 0 errors, warnings read.
- [ ] In the roster; AirKit commit `cos: COS_<Name> — …` pushed to `mirror`; `airkit.lock` `sha=` updated and committed.
- [ ] `AUDITION PASS`; rest sound as designed; no clipping; peaks within the level plan; silent after unload; table in the note.
- [ ] Runs with no params and with each declared param; `~onSceneParams` defined if params are read.
- [ ] If samples: `SHOPPING.md` written, Ciaran downloaded, `samples:check` exit 0, `manifest.json`/`SOURCES.md` committed.
- [ ] Hand-off sent in piano/drum terms; iteration log started.

## Models

Research subagents run on a **mid-tier** model (they read and summarise; six of them in
parallel). Designing and writing the patch — steps 3, 4 and every iteration — run on the
**most capable** model available; do not delegate the patch itself to a subagent.

## Rules that bite

- **Engine facts win** over the profile, the references, the corpus and the research.
- **No `s.sync`, `.wait`, `Buffer.read` or `SynthDef(` in a tick** — the tick runs on AppClock;
  a block or an uncaught error freezes the slot silently. Load and build in `~init`.
- **`~sceneParams` defaults**: every patch runs correctly with no params; read
  `topEnvironment[\cosSlotParams][d.index]` in `~init` *and* handle `~onSceneParams` (which can
  arrive before `~init`, or on the patch about to be replaced — guard every synth reference).
  String values arrive as Symbols.
- **`~partner` nil-guard for `2H`**: a one-hand patch never dereferences `~partner`; a `2H`
  patch guards it and re-reads `~partner.env[\model]` every tick, never caches it.
- **Silent within 200 ms of `~deinit`**: capture and nil refs first, `gate` 0 with a short
  release, free groups and then buffers after the tail.
- **Cheap when unheard**: a preloaded standby patch ticks on real motion at level 0 for a whole
  scene, eight patches at once — bounded voices, leaky clamped integrators, no queued events,
  no loop that arrives already ringing.
- Stillness is designed, never "nothing by default". A ceiling on every output; the ensemble
  must still be heard.
- Samples load only through `topEnvironment[\cosSamples]` / `~cosSamples` and the manifest —
  never a literal path. sc3-plugins are allowed; verify class and arguments locally.
- Never kill or restart a running engine or runner without asking; never `Cmd-.`; never edit
  `~/AirKit`; commit to the AirKit branch only from `airkit/`, prefixed `cos:`.
