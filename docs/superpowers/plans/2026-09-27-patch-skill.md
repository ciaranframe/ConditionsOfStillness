# Patch Skill and Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the piece a generic, profile-driven `airkit-patch` skill and the tools it runs: corpus mining of Steph's personalities across AirKit branches, a linter, a headless parse check, a roster editor, take recording, an audition tool that plays a patch on the engine's audition slot with synthetic gestures or recorded takes, and the shopping-list samples workflow — so that the first real patches (sub-project 5, with Ciaran's per-scene context) can be researched, written, checked and heard without touching a wrist mid-rehearsal.

**Architecture:** Everything lives in the piece repo: the skill under `.claude/skills/airkit-patch/` (generic; reads a profile), the piece profile at `patching/profile.md`, tools under `patching/tools/` (Node ≥ 22 TypeScript run directly, `node --test`, no framework), mined corpus under `patching/corpus/` (raw gitignored; `index.json`, `INDEX.md`, `digest.md` committed), samples under `samples/COS_<Name>/`, takes under `takes/`. The tools reuse the repo's OSC codec (`scripts/lib/osc.ts`) and the runner's stick/fake modules where useful (`runner/test/fake-sticks.ts`, `runner/test/fake-airkit.ts`). The audition tool talks to the engine's existing audition slot 9 through a private device on slot 9's bus (a device created from a second source port shares the slot's bus, spec §5 Review Focus 4 / engine review), so it works next to a running runner or against a private engine boot. Glimmer's `new-patch` skill and tools are the template (copied with attribution and re-parameterised by the profile), COTF's Patch Lab bible and Steph's authoring docs are consolidated into the references.

**Tech Stack:** Node ≥ 22.18 TypeScript (strip-only: no parameter properties, no enums), `yaml` 2.x, `node --test`, git plumbing (`git ls-tree`, `git cat-file`, `git show`) against the `airkit/` worktree's object store, sclang headless (`/Applications/SuperCollider.app/Contents/MacOS/sclang`), ffmpeg/ffprobe (Homebrew), the `[COS]` OSC contract in `airkit/code3.0/API.md`.

**Spec:** `docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md` §7 (skill, profile, tools, corpus facts), §8 (samples), §5 patch-contract additions, §5.1 engine facts, §9 setup, §13 risks. Reference sources (read-only): Glimmer `/Users/ciaran/Documents/Glimmer/.claude/skills/new-patch/` (SKILL.md, references/{bible,patterns,pitfalls,research}.md, assets/TEMPLATE.sc) and `/Users/ciaran/Documents/Glimmer/code/airkit-glimmer/tools/{patch-lint.ts,patch-compile.sh,patch-audition.ts}`; COTF `/Users/ciaran/Documents/ConcertsOfTheFuture/Code/audio/airkit-lab/{BIBLE.md,bible/patterns.md,bible/pitfalls.md,bible/*.annotated.md,lint/RULES.md,PROMOTE.md}`; Steph `/Users/ciaran/AirKit/code3.0/{personality_authoring.md,concert_p_files.md}`; the engine `airkit/code3.0/{personalityController.scd,oscController.scd,conditions/*.scd,API.md}` and `airkit/personalities/COS_Template.sc`.

## Rulings made by the controller on 2026-09-27 (Ciaran away; binding for this plan)

1. **Tools live in `patching/tools/` with their own `package.json`** (dependency `yaml` only; ffmpeg via the CLI); tests in `patching/tools/test/*.test.ts`; the root `npm test` runs them too; `./setup.sh` already installs `patching/tools` deps.
2. **Corpus mining is git-object-only** (`git -C airkit ls-tree` / `cat-file` on `origin/<branch>`; nothing checked out), over `personalities/` and `synths/` of `Airsticks-RPI`, `Airsticks-Desktop`, `MiMBrentonShows`, `master`, `AirConcert`; files are deduplicated by blob hash across branches (one raw copy, the index lists every branch/path it appears at); the vendored `sc_osx_standalone-3.7.0-template/` tree is excluded; filenames with spaces and `Name 2.sc`/`… copy.sc` duplicates are handled (kept in the index, flagged `duplicateOf`). The tool produces `index.json`, `INDEX.md` and a statistics digest; the prose `digest.md` ("recurring logics with pointers") is written by a subagent reading the mined files (Task 9) and committed.
3. **The audition tool uses a private device on slot 9's bus**: it sends `/9/IMUFusedData` from its own source port (default 9101 → device port 9109, index 9) and loads the patch on that device port; it never binds 9001 and never touches slots 1–8. It runs against the running engine on 57120 when one answers `getStatus` within 1 s, else boots a private engine on 57130/57131 (the smoke recipe). It polls `getStatus` at 5 Hz while running so the levels broadcast stays with it (the runner's 2 s poll steals it briefly; acceptable, noted in the README).
4. **Take format** `takes/<label>.take.jsonl`: first line `{"label","wrist","id","startedAt","hz"}`, then one line per packet `{"t":<ms since start>,"a":[ax,ay,az],"q":[qx,qy,qz,qw]}`; recorded from the runner's stick port (the recorder binds its own UDP port, default 8001, and the stick is repointed with `/Config/RequestStream` by hand — the README says how) **or** from a copy the runner forwards (not built now: the runner has no tap; recording happens with the runner stopped or on the spare port). `takes/INDEX.md` gets a row per take.
5. **Compile check** = Glimmer's idiom: a throwaway `sclang -u 57190` that calls `thisProcess.interpreter.compile(File.readAllString(...))` and posts `COMPILECHECK: OK` / `PARSE FAILED`, then `0.exit`. sclang has no compile-only flag on this machine.
6. **Lint rule set** = Glimmer's 22 rules re-parameterised by the profile, minus `name.glim-prefix`/upstream overlay rules, plus COS rules: `header.keys` (the eleven keys of `COS_Template.sc`: gestures, description, internals, sound, pitch, rhythm, family, params, samples, research — `internals` and `research` warn-only), `name.cos-prefix` (`COS_UpperCamel`, `2H` suffix only when the file reads `~partner`), `hooks.scene-params` (a patch that reads `~sceneParams`/`~cosSlotParams` must define `~onSceneParams`; a patch that declares `params:` other than `none` must read them), `partner.guard` (a non-`2H` patch must not dereference `~partner`; a `2H` patch must nil-guard `~partner.env[\model]` reads — engine §5.1), `sample.manifest` (any `Buffer.read*` path must be built from `topEnvironment[\cosSamples]` or `~cosSamples`, never a literal path), `state.idle-alias` (the four state ticks must all be defined; aliasing `~tuningNext = ~idleNext` etc. is the expected form), `synthdef.prefix` = `cos<Name>`; unknown classes are checked against `SCClassLibrary` **and** `~/Library/Application Support/SuperCollider/Extensions` (sc3-plugins are installed here and allowed by the spec).
7. **Samples**: `SHOPPING.md` is a table the skill writes and `samples-check.ts` parses (`| slot | what | length | channels | pitched | licence |`); files are matched by filename prefix `<slot>-` (interactive assignment is out: the tool prints what is unmatched and exits 1); conversion to 48 kHz WAV (mono when the slot says mono) into `samples/COS_<Name>/wav/`; `manifest.json` = `{ "<slot>": { "file": "wav/<slot>.wav", "frames", "channels", "sr", "source": "<original filename>" } }`; `SOURCES.md` skeleton with one row per slot for Ciaran to complete.
8. **Roster editing** is a tool (`patch-roster.ts add|remove <Name>`) that rewrites `airkit/lists/list_conditions.sc` atomically, keeping index 0 `silence` and the trailing `silence` sentinel; the lint checks the patch is in the roster (warn).
9. **No patch is written in this sub-project.** The pipeline gate is `COS_Template`: lint clean, compile OK, audition passes on the real engine. The skill's research steps are validated with a dry run that produces a research note for a fictitious brief and stops before writing a patch.
10. **The profile's `TEMPLATE.sc` is `airkit/personalities/COS_Template.sc`** (pointer, not a copy), as the spec says.

## Global Constraints

- Node ≥ 22.18 TypeScript run directly by Node (strip-only: no constructor parameter properties, no enums, no namespaces); tests are `node --test`; every file a tool writes goes to a temp path then `rename` (the engine hot-reloads personalities on mtime — a half-written `.sc` must never exist).
- Never modify `~/AirKit`; the AirKit branch is edited only in `airkit/` (worktree on `AirConditions`), commits prefixed `cos:`, additive, pushed to `mirror`; API.md updated in the same commit for any OSC change (none expected here).
- Corpus mining reads git objects only (`git -C airkit …`); raw mined files are gitignored (`patching/corpus/*/`); `index.json`, `INDEX.md`, `digest.md` are committed.
- Patch names `COS_<UpperCamel>`, two-hand patches end in `2H`; SynthDef names `cos<Name>…`; personality files at `airkit/personalities/COS_<Name>.sc`; roster `airkit/lists/list_conditions.sc` shaped `["silence", …, "silence"]`.
- The engine contract for patches (spec §5, `API.md` `[COS]`): `~sceneParams` read in `~init` from `topEnvironment[\cosSlotParams][d.index]`, `~onSceneParams = { |p| }` for later updates, every patch runs with no params; `~partner` nil for one-hand sounds, `~partner.env[\model]` re-read every tick for `2H`; room state always `\idle`, `~onRoomState` still handles `\silent`; silent within ~200 ms of `~deinit`; cheap when unheard (preloaded on a standby slot).
- Audition slot 9; a device created from source port P with `/N/…` lands on port P + N − 1 with index N and shares slot N's bus; the levels broadcast goes to the last `/airkit/cos/*` sender; only `getStatus` proves the engine is up.
- Samples root `topEnvironment[\cosSamples]` = `COS_SAMPLES` (run.sh sets it to the repo's `samples/`); audio gitignored, `SHOPPING.md`/`manifest.json`/`SOURCES.md` committed.
- sclang at `/Applications/SuperCollider.app/Contents/MacOS/sclang`; test engines use 57130/57131 (audition boot) and 57190 (compile check) and kill only their own processes; never touch 57120/57110 except to *talk* to a running engine.
- Piece-repo commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A mined file whose name contains spaces or a `copy`/`2` suffix, or whose blob is identical on several branches: the miner must not mis-split paths, must record every branch/path, and must keep one raw copy — pinned in Task 2.
2. A patch that declares `samples:` and reads a literal absolute path: lint must fail (`sample.manifest`), and a patch whose `2H` name does not match its `~partner` use must fail — pinned in Task 3.
3. The audition tool run while the runner is live must never bind 9001 nor load anything on ports 9001–9008, and must leave slot 9 on `silence` and the audition level restored afterwards — pinned in Task 6 (assertions on the engine's seats and status after the run).
4. A take whose stick id is not the one requested, or whose stream stops mid-recording: the recorder ignores other ids and closes the file cleanly with the rows it has — pinned in Task 5.
5. `samples-check.ts` on a folder with an unreadable or wrong-format file, or a file that matches no slot: it reports per file, converts what it can, exits 1, and never leaves a half-written `manifest.json` — pinned in Task 7.

---

## File map

```
.claude/skills/airkit-patch/
  SKILL.md                      the generic skill: steps, invocation (`/airkit-patch <brief> [--profile path]`), hand-off format
  references/engine.md          patch contract + lifecycle + hooks + gesture model, consolidated, citations re-checked on AirConditions
  references/patterns.md        idioms incl. two-hand, scene params, crossfade-aware exit, energy tiers, stillness reveals, direction
  references/pitfalls.md        union of Glimmer + COTF + Steph + engine §5.1
  references/research.md        six tracks A–F, subagent brief templates, note template
  references/samples.md         the shopping-list workflow from the skill's side
  references/profile-schema.md  what a profile must contain
  assets/note-template.md  assets/shopping-template.md  assets/header-template.txt
patching/
  profile.md                    the piece profile (spec §7)
  notes/README.md               one research note per patch lands here
  corpus/INDEX.md index.json digest.md  (generated + written; raw under corpus/<branch>/ gitignored)
  tools/package.json  tools/README.md
  tools/src/{git.ts, mine.ts, lint.ts, roster.ts, take.ts, phases.ts, audition.ts, samples.ts, atomic.ts, sc.ts}
  tools/{corpus-mine.ts, patch-lint.ts, patch-compile.sh, patch-roster.ts, take-record.ts, patch-audition.ts, samples-check.ts}   thin CLIs
  tools/test/*.test.ts  tools/test/fixtures/
samples/README.md
takes/INDEX.md (row appended by take-record)
package.json (root: test glob + scripts patch:lint, patch:compile, patch:audition, corpus:mine, samples:check)
README.md (Patching section)
```

---

### Task 1: Tools scaffold, atomic writes, sclang helpers, compile check, profile and folders

**Files:**
- Create: `patching/tools/package.json`, `patching/tools/src/atomic.ts`, `patching/tools/src/sc.ts`, `patching/tools/patch-compile.sh`, `patching/profile.md`, `patching/notes/README.md`, `samples/README.md`, `patching/tools/README.md`
- Test: `patching/tools/test/atomic.test.ts`, `patching/tools/test/compile.test.ts`
- Modify: `package.json` (root): test glob adds `"patching/tools/test/*.test.ts"`; scripts `patch:compile`, `patch:lint`, `patch:audition`, `patch:roster`, `corpus:mine`, `take:record`, `samples:check` (each `node patching/tools/<tool>.ts` or the `.sh`)

**Interfaces:**
- Produces: `writeAtomic(path: string, text: string): void` (temp `${path}.${pid}.tmp` + `renameSync`, `mkdirSync` of the parent); `SCLANG: string` (`/Applications/SuperCollider.app/Contents/MacOS/sclang`); `repoRoot(): string` (walk up from the tool file to `airkit.lock`; `COS_REPO_ROOT` overrides); `airkitRoot(): string` = `<repoRoot>/airkit`; `personalityPath(name: string): string`; `rosterPath(): string`; `compileCheck(file: string, port = 57190): { ok: boolean; output: string }` (spawnSync of sclang with a temp `.scd`, Glimmer's idiom, 30 s timeout, `COS_CHECK_FILE` env); the CLI `patch-compile.sh <Name|path>` exits 0/1/2 like Glimmer's.

- [ ] **Step 1: `patching/tools/package.json`**
```json
{ "name": "conditions-patch-tools", "private": true, "type": "module", "engines": { "node": ">=22.18" },
  "scripts": { "test": "node --test \"test/*.test.ts\"" }, "dependencies": { "yaml": "^2.9.1" } }
```
`cd patching/tools && npm install` (commit `package-lock.json`).

- [ ] **Step 2: tests first**

`patching/tools/test/atomic.test.ts`: writes a file into a `mkdtemp` dir via `writeAtomic`, asserts the content and that the directory holds only the final file (no `.tmp`); a second write replaces the content.

`patching/tools/test/compile.test.ts` (integration; skips with `t.skip()` when `SCLANG` is missing): `compileCheck(<repo>/airkit/personalities/COS_Template.sc)` → `ok === true`; a temp file containing `var x = ;` → `ok === false` and `output` matches `/PARSE FAILED|ERROR/`. Each call takes ~3 s.

- [ ] **Step 3: implement** `src/atomic.ts`, `src/sc.ts` (`repoRoot`, `airkitRoot`, `personalityPath`, `rosterPath`, `SCLANG`, `compileCheck`), `patch-compile.sh` (copy Glimmer's `tools/patch-compile.sh` with attribution; env var `COS_CHECK_FILE`; resolve a bare name to `airkit/personalities/<Name>.sc`; port 57190).

- [ ] **Step 4: `patching/profile.md`** — the piece profile (spec §7 "The piece profile"), sections in this order, each a short paragraph or list: Piece and instruments (wrist-worn sticks on a pianist and a bass drummer; what playing looks like to the IMU: hands over keys — small vertical accelerations, wrist rotation on chords, tremolo as high-frequency shake; drum strokes — sharp accel spikes with a rebound, damping as a still hand on the head; the non-playing hand; rest as a musical state); Naming (`COS_<UpperCamel>`, `2H` suffix, SynthDef prefix `cos<Name>`); Roster path (`airkit/lists/list_conditions.sc`); Template (`airkit/personalities/COS_Template.sc`, the runnable skeleton); Scene-parameter contract and recommended keys (`register` low|mid|high, `density` 0–1, `brightness` 0–1, `pitchset` name, `rate` Hz, `wet` 0–1; any scalar passes through); Two-hand contract (`~partner`, its `env[\model]` re-read per tick, right wrist silent); Level plan (stereo PA; peaks −12…−6 dBFS when shaken hard; the ensemble must still be heard; the master limiter is a safety, not a tool); Plugins (sc3-plugins 3.14 allowed; lint checks installed classes); Audition (slot 9; `npm run patch:audition -- <Name>`); Takes (`takes/<label>.take.jsonl`, `takes/INDEX.md`); Samples (`samples/COS_<Name>/`, `SHOPPING.md` → `samples-check` → `manifest.json`; patches load through `topEnvironment[\cosSamples]`); Hand-off format (gestures described in piano and drum terms; what to listen for; params to try); Where context lives (`patching/context/`, read in full before research); Research note location (`patching/notes/COS_<Name>.md`).

- [ ] **Step 5: folders and docs** — `patching/notes/README.md` (one note per patch, template in the skill's assets); `samples/README.md` (the §8 workflow in five lines); `patching/tools/README.md` (each tool: one line + usage).

- [ ] **Step 6: run** `cd patching/tools && npm test` and root `npm test`. **Commit** `patching: tools scaffold, atomic write, compile check, piece profile`.

---

### Task 2: Corpus mining

**Files:**
- Create: `patching/tools/src/git.ts`, `patching/tools/src/mine.ts`, `patching/tools/corpus-mine.ts`
- Test: `patching/tools/test/mine.test.ts` (fixture repo built with `git init` in a temp dir: two branches, a shared blob, a file with a space in its name, a `Foo copy.sc`, a file under `sc_osx_standalone-3.7.0-template/`)
- Output (generated, committed except raw): `patching/corpus/index.json`, `patching/corpus/INDEX.md`, `patching/corpus/stats.md`; raw under `patching/corpus/<branch>/…` (gitignored by the existing `patching/corpus/*/` rule — verify `INDEX.md`/`index.json`/`stats.md` at the top level are *not* ignored)

**Interfaces:**
- `listTree(repo: string, ref: string, prefixes: string[]): Array<{ path: string; blob: string; size: number }>` — `git ls-tree -r -l -z <ref> -- <prefixes>` parsed on NUL (handles spaces); filters `.sc` only; excludes any path containing `sc_osx_standalone`.
- `readBlob(repo: string, blob: string): string` — `git cat-file -p <blob>` (utf8; non-UTF8 bytes replaced).
- `analyse(source: string): FileFacts` — `{ headerKeys: string[]; ugens: string[]; idiom: 'pdef'|'ndef'|'synth'|'hybrid'|'none'; modelFields: string[] (every `m.<field>`/`~model.<field>` read); hooks: string[] (`~init`, `~deinit`, `~idleNext`, `~pieceNext`, `~onRoomState`, `~onResync`, `~onSceneParams`…); thresholds: number[] (numeric literals compared against gesture fields, best effort); samples: boolean (`Buffer.read`/`readChannel`/`alloc`); lines: number }`.
- `mine(opts: { repo: string; branches: string[]; out: string; refPrefix?: 'origin/' }): Index` writing raw files (one copy per blob at `<out>/<firstBranch>/<path>`), `index.json` (`{ minedAt, branches: {name, ref, files}, entries: [{ name, blob, size, lines, branches: [{branch, path}], duplicateOf?: string, facts: FileFacts }] }`), `INDEX.md` (a table per branch: name, idiom, UGen count, samples, size, "also on"), `stats.md` (UGen histogram top 40, idiom counts, header-key coverage, sample-use %, size percentiles, per-branch totals).
- CLI `corpus-mine.ts [--repo airkit] [--branches a,b,…] [--out patching/corpus]`; defaults per ruling 2; prints totals; exit 1 on a git error.

- [ ] Steps: fixture test first (counts per branch, dedupe by blob, the spaced filename round-trips, `copy.sc` gets `duplicateOf` = the entry with the same blob or a name that strips ` copy`/` 2`, the standalone tree is excluded, `INDEX.md` lists the file with a space) → implement → run the real mining (`npm run corpus:mine`; expect 233/187/130/71/32 personalities plus synths; record the totals in the commit message) → commit `patching: corpus mining — index, INDEX.md, stats over five AirKit branches`.

---

### Task 3: Linter

**Files:**
- Create: `patching/tools/src/lint.ts`, `patching/tools/patch-lint.ts`
- Test: `patching/tools/test/lint.test.ts` with inline fixture sources and `fixtures/` files
- Consumes: `repoRoot`, `personalityPath`, `rosterPath` (Task 1); the profile facts (prefix, roster path, template header keys) are constants in `lint.ts` read from a small `profile.json` section? **Ruling:** the linter reads its parameters from the top of `patching/profile.md` front-matter — add a YAML front-matter block to `profile.md` in this task: `prefix: COS_`, `synthdefPrefix: cos`, `roster: airkit/lists/list_conditions.sc`, `personalities: airkit/personalities`, `template: airkit/personalities/COS_Template.sc`, `headerKeys: [gestures, description, internals, sound, pitch, rhythm, family, params, samples, research]`, `optionalHeaderKeys: [internals, research]`, `samplesVar: cosSamples`, `plugins: true`.

**Rules** (id — severity — check), adapted from Glimmer's `patch-lint.ts` (copy with attribution; keep its `stripNonCode`, class-index builder and SynthDef scanner):
`header.missing-block` E; `header.keys` E for a missing required key, W for optional; `header.gestures-grammar` E (`[a, b, c]` of known gesture words: sway shake tilt strike stillness hold turn flip twist roll direction); `name.cos-prefix` E; `name.two-hand` E (`2H` ⇔ the file reads `~partner`); `hooks.required` E (`~init`, `~deinit`, `~onRoomState`, `~idleNext`); `state.idle-alias` W (`~tuningNext`/`~pieceNext`/`~curtainNext` defined, alias form expected); `state.silent-unhandled` E; `hooks.scene-params` E/W per ruling 6; `partner.guard` E; `style.compose` W (`~init = ~init <> {`, `~deinit = ~deinit <> {`); `tick.blocking` E (`s.sync`, `.wait`, `.yield`, `Buffer.read`, `SynthDef(` inside a tick); `tick.posting` W (`.postln` inside a tick); `banned.outbus-rewire` E; `banned.server-control` E (`s.boot`, `s.quit`, `s.reboot`, `Server.default =`); `banned.global-write` E (`topEnvironment[…] =`, `~cos… =` outside allowed reads); `banned.abs-path` E; `sample.manifest` E; `bus.private`/`bus.unfreed` W; `synthdef.prefix` E; `synthdef.duplicate` E (same name twice in the file); `synthdef.collision` E (name defined by another file in `airkit/personalities/` or the engine); `pdef.literal-name` W; `class.unknown` E (class-index from `SCClassLibrary` + Extensions, incl. `SC3plugins`); `class.library-not-found` W; `roster.missing` W; `size.too-large` W (> 64 KB). Output: `[E]`/`[W]` lines `rule id — file:line — message`, `--json`, exit 0 no errors / 1 errors / 2 usage.

- [ ] Steps: tests first (the template lints clean; one fixture per rule fires; the `2H` mismatch both ways; a literal `Buffer.read(s, "/Users/…")` fails `sample.manifest` while `Buffer.read(s, topEnvironment[\cosSamples] +/+ …)` passes; class index finds `Quaternion` from Extensions and a sc3-plugins class like `MdaPiano`) → implement → `npm run patch:lint -- COS_Template` clean → commit.

---

### Task 4: Roster tool and take recorder

**Files:**
- Create: `patching/tools/src/roster.ts`, `patching/tools/patch-roster.ts`, `patching/tools/src/take.ts`, `patching/tools/take-record.ts`
- Test: `patching/tools/test/roster.test.ts`, `patching/tools/test/take.test.ts` (uses `runner/test/fake-sticks.ts` to stream ids `3` and `9` to the recorder's port; asserts only id 3 is recorded, the header line, monotonic `t`, the `INDEX.md` row; stopping the sticks mid-run still yields a valid file)
- Interfaces: `parseRoster(text): string[]`, `renderRoster(names: string[]): string` (keeps the file's comment header), `rosterAdd(name)`, `rosterRemove(name)` (atomic; index 0 and the trailing sentinel preserved; idempotent); CLI `patch-roster.ts add|remove|list <Name>`. `recordTake({ port = 8001, id | wrist (via scenes/cast.yaml), label, seconds?, out = takes/ })` → writes `takes/<label>.take.jsonl` per ruling 4 and appends `| label | wrist | date | seconds | what |` to `takes/INDEX.md` (`what` from `--what "…"`); CLI `take-record.ts <label> --wrist ZL|--id 3 [--seconds 30] [--port 8001] [--what "piano scales slow"]`; Ctrl-C ends the take cleanly.

- [ ] Steps: tests → implement → commit.

---

### Task 5: Audition phases and take replay (pure)

**Files:**
- Create: `patching/tools/src/phases.ts`
- Test: `patching/tools/test/phases.test.ts`
- Interfaces: `type Pose = { a: [number, number, number]; q: [number, number, number, number] }`; `syntheticPhases(): Phase[]` with `Phase = { name: 'rest'|'tilt'|'sway'|'shake'|'strike'|'still'|'settle'; seconds: number; pose: (t: number) => Pose }` — rest (gravity −9.8 on z), tilt (rotate 40° over 2 s and hold), sway (0.5 Hz ±3 m/s²), shake (6 Hz ±6), strike (five spikes of 25 m/s² 20 ms wide with rebound), still (4 s at rest — the stillness reveal), settle; `takePhases(lines: string[]): Phase[]` parses a take file into one phase per 5 s window replaying recorded rows at their timestamps; `expected(phase): { minPeak?: number; maxPeak?: number }` (rest/still: ≤ 0.02 unless the profile says the patch sounds at rest; shake/strike ≥ 0.01; never ≥ 0.98).

- [ ] Steps: tests (a take fixture of 200 rows → phases with correct durations; synthetic phases produce finite poses; a strike phase contains spikes) → implement → commit.

---

### Task 6: Audition tool (integration with the engine)

**Files:**
- Create: `patching/tools/src/audition.ts`, `patching/tools/patch-audition.ts`
- Test: `patching/tools/test/audition.test.ts` against `runner/test/fake-airkit.ts` (unit: it loads on port 9109 only, polls status, reads levels, unloads; asserts no packet to 9001–9008 and the audition level restored) plus an integration run by the implementer against the real engine (boot mode) recorded in the report.
- Behaviour (ruling 3): `--engine running|boot|auto` (auto = try 57120 `getStatus` for 1 s, else boot 57130/57131 with the smoke recipe and `COS_SAMPLES=<repo>/samples`, log at `~/.conditions/audition.log`); source port `--src 9101`; before loading: `/airkit/cos/params 9 …` from `--params k=v,…`, `/airkit/cos/partner 9 0`, `/airkit/cos/level audition 1 0.1`, `/airkit/cos/audition <wrist?>` unset; then `/airkit/loadPersonality 9109 <index>` (index from `getRoster`; error if not in the roster), wait `ready` for the device (the status reply's slot 9 entry describes whichever device has index 9 — if two exist, note it), run the phases while polling `getStatus` at 5 Hz and reading `/airkit/cos/levels` (audition peak/rms) per phase, `--long` adds a "preloaded 60 s then heard" phase (level 0 for 60 s at rest, then shake at level 1), then `loadPersonality 9109 0`, check silence within 1 s, tail the engine log for `ERROR|not understood|DoesNotUnderstand|FAILURE` since the run began; print a table per phase (peak dBFS, rms, verdict) and exit 0/1/2. When `--engine boot`, kill only its own sclang/scsynth on exit.

- [ ] Steps: unit test against the fake → implement → `npm run patch:audition -- COS_Template --engine boot` passes (report the table) → commit.

---

### Task 7: Samples workflow tool

**Files:**
- Create: `patching/tools/src/samples.ts`, `patching/tools/samples-check.ts`
- Test: `patching/tools/test/samples.test.ts` (generates two WAVs with `ffmpeg -f lavfi -i sine=…` in a temp `samples/COS_Fixture/`, a `SHOPPING.md` with slots `hit` (mono, ≤ 1 s) and `bed` (stereo, 4–10 s), an unmatched `stray.wav` and a corrupt `bed-x.wav`; asserts the conversions, `manifest.json` shape, `SOURCES.md` rows, exit code 1 with the two problems listed, and that a failed run leaves no `manifest.json.tmp`)
- Interfaces: `parseShopping(md): Slot[]` (`{ slot, what, lengthSec?: [min,max], channels: 'mono'|'stereo', pitched: boolean, licence: string }`); `probe(file): { ok, channels, sr, seconds, error? }` via `ffprobe -v error -show_entries stream=channels,sample_rate:format=duration -of json`; `convert(src, dst, channels)` via `ffmpeg -y -i src -ar 48000 -ac 1|2 -c:a pcm_s24le dst`; `writeManifest`, `writeSourcesSkeleton`; CLI `samples-check.ts COS_<Name> [--dir samples/]`.

- [ ] Steps: tests → implement → commit.

---

### Task 8: Skill references (writing task, most capable model)

**Files:**
- Create: `.claude/skills/airkit-patch/references/{engine.md,patterns.md,pitfalls.md,research.md,samples.md,profile-schema.md}`, `assets/{note-template.md,shopping-template.md,header-template.txt}`
- Sources to consolidate (read them all): Glimmer `references/{bible,patterns,pitfalls,research}.md`; COTF `BIBLE.md`, `bible/{patterns,pitfalls}.md`, the five `*.annotated.md`; Steph `personality_authoring.md`, `concert_p_files.md` (all 26 recipes); the engine files and `API.md` `[COS]`; `COS_Template.sc`; spec §5, §5.1, §7.
- `engine.md`: lifecycle with `file:line` citations **re-checked on the `AirConditions` worktree** (`airkit/code3.0/personalityController.scd`: env creation, `~model` fields with units and ranges as derived, `~outBus`, hook stubs, `interpret`, load order, `~deinit` async, tick loop and `d.lastTick`), the `[COS]` additions (`~sceneParams` before-or-after load, `~onSceneParams`, `~partner` and `env[\model]`, room state always `\idle`, `\silent` handling, slot pairs and standby preload → crossfade-aware exit, audition slot), the gesture model (accel with gravity, quaternion, derived `gyro*Filtered`, `accelMass`, calibration), what a patch must never do (`s.sync` in a tick, absolute sample paths, server control, `topEnvironment` writes except the documented reads).
- `patterns.md`: the idioms with citations into the mined corpus (`patching/corpus/<branch>/<path>` + line) and Steph's recipes: long-lived synth + `.set`, Pdef on a clock without a conductor, sample map + load guard through `~cosSamples`, granular pad, hit detection (threshold + refractory + hysteresis), energy tiers, stillness reveal, direction/reversal primitives, two-hand (partner energy, mirror/complement), scene-param mapping (`register`, `density`…), crossfade-aware exit (cheap when unheard; no state explosion on first hearing), silent-within-200-ms deinit.
- `pitfalls.md`: the union (Glimmer 23 + COTF + Steph §12 + engine §5.1's handler-timing and partner-model notes), each with the symptom, the cause and the fix, one screen each at most.
- `research.md`: six tracks A physics, B synthesis prior art, C musical world, D gesture/mapping, E SuperCollider practice (UGen choice, CPU, sc3-plugins), F Steph's corpus (how to query `index.json`/`INDEX.md`/`digest.md`, what to copy and cite); parallel subagent brief template per track; return format (5–12 findings with sources); synthesis into a design; the note template.
- `samples.md` and `profile-schema.md` per spec; assets accordingly.
- [ ] Steps: read → write (each file under 400 lines; citations checked with `grep -n`) → a `pages`-style test is not needed; a small script check that every `file:line` citation in `engine.md` points at a line containing the quoted token (write `patching/tools/test/citations.test.ts`) → commit.

---

### Task 9: Corpus digest (writing task over the mined index)

**Files:** `patching/corpus/digest.md`
- Read `index.json`/`stats.md`, then 40 representative files (top UGen users, each idiom, each branch, sample users, the largest, the oldest) and write `digest.md`: recurring logics (10–20), each with a two-line description, when to use it, and pointers (`<branch>/<path>:line`); a "traps seen" list; a "worth stealing" shortlist for the piece's instrument context (piano hands, drum strokes, stillness). Under 300 lines. Commit.

---

### Task 10: SKILL.md, dry run, README, setup

**Files:** `.claude/skills/airkit-patch/SKILL.md`, `README.md` (Patching section), `docs/superpowers/plans/…` unchanged, `setup.sh --check` still green.
- `SKILL.md` frontmatter `name: airkit-patch`, `description: Research, write, check and audition an AirKit personality for a piece; profile-driven; use for "write a patch", "new sound for scene X", "/airkit-patch"`; invocation `/airkit-patch <brief> [--profile patching/profile.md]`; the steps (spec §7): read profile + context folder in full → read the brief like a composer → six-track research in parallel subagents → design + note (`patching/notes/COS_<Name>.md`) → write atomically from the template → compile check → lint → roster add → audition (report the table) → samples step if the header declares slots (write `SHOPPING.md`, stop and ask Ciaran to download) → hand-off (gestures in piano/drum terms, params, what to listen for) → iterate on notes. A "definition of done" checklist. Model guidance: research subagents on a mid model, the patch writing on the most capable.
- Dry run: invoke the skill's research stage only for a fictitious brief ("a breath-like sound for a still left hand over the keys") producing `patching/notes/COS_DryRun.md`; then delete the note (or keep it as `patching/notes/EXAMPLE.md`; ruling: keep as the example) — no patch file, no roster change.
- Pipeline gate on the template: `npm run patch:lint -- COS_Template`, `npm run patch:compile -- COS_Template`, `npm run patch:audition -- COS_Template --engine auto` all pass (record output in the report).
- README: Patching section (tools, the skill, the workflow, where notes/samples/takes live). Commit.
