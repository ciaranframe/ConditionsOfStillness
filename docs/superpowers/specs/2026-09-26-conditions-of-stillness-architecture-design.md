# Conditions of Stillness — AirStick system architecture

- **Date:** 2026-09-26
- **Status:** approved in conversation (sections 1–5), umbrella spec; each sub-project gets its own plan
- **Author:** Ciaran + Claude (brainstorming session 1)
- **Related:** `2026-09-15-patch-marks-plugin-design.md` (score marks), `2026-06-14-airstick-osc-recorder-design.md` (take recording, browser BLE), COTF `docs/superpowers/specs/2026-08-22-patch-lab-design.md`, Glimmer `.claude/skills/new-patch/`

## 1. Summary

*Conditions of Stillness* is a composed piece for two AirStick-wearing performers and a chamber
ensemble. Zubin (piano) and Claire (bass drum) each wear one AirStick on each wrist, in Apple
Watch bands. Behind them: flute, clarinet/bass clarinet, violin, cello (no sticks). The piece is
in free time, fully notated in Sibelius, and moves through many **scenes**; each scene assigns a
**sound** (an AirKit personality plus parameters) to each wrist, and scene changes crossfade over
0.1–10 s. Zubin advances scenes with a MIDI footswitch (next and back); the cue points are
notated in the score with the existing PatchMarks plugin. One laptop runs everything into a
stereo PA. Ciaran can watch and assist from the sound desk on an iPad.

This spec fixes the vocabulary, the repo and git strategy, and the architecture of four
sub-projects, in build order:

1. **Foundation** — piece repo, AirKit branch and worktree, private mirror, setup and run scripts.
2. **Engine profile** — `code3.0/conditions/` on the `AirConditions` branch: 9 slots, per-wrist
   crossfaders, scene parameters, two-hand sounds, status and levels.
3. **Runner and interfaces** — Node runner: scenes file, pedal, OSC to AirKit, Perform page for
   Zubin, Admin page for Ciaran.
4. **Patch skill and tooling** — generic `airkit-patch` skill with a piece profile, corpus mining
   of Steph's personalities, six-track research, lint, compile, take recording, audition on the
   audition slot, and the shopping-list samples workflow.

Patches are written **after** 1–4, using the skill. Musical context per patch is supplied by
Ciaran at that point (`patching/context/`).

## 2. Goals and non-goals

### Goals
- Everything needed to rehearse and perform the piece lives in this repo plus one AirKit branch,
  and can be set up on another Mac with one script.
- Scene changes are instant on the pedal and musically crossfaded; both outgoing and incoming
  sounds respond to the wrists during the fade.
- Patches respond to real playing motion (piano hands, bass drum strokes) as well as free gesture.
- The AirKit branch stays small and additive so it can be offered upstream to Steph later.
- The patch skill is generic (profile-driven) and deeper than the Glimmer and COTF skills: web
  research on synthesis and SuperCollider practice, mining of Steph's 200+ personalities across
  branches, and a sample-dropping workflow.

### Non-goals (this spec)
- No link between the Sibelius score and the scenes file (decision: scenes file only).
- No conductor, beat clock, backing track, or score-following (free time).
- No spatialisation beyond stereo.
- No patches are written under this spec.
- No changes to the Glimmer or COTF repos.

## 3. Vocabulary

Used everywhere: scenes file, pages, engine, skill, docs.

| Term | Meaning |
|---|---|
| **Performer** | `Z` = Zubin (piano), `C` = Claire (bass drum). |
| **Wrist** | One stick as the piece knows it: `ZL`, `ZR`, `CL`, `CR`. Hardware IDs (e.g. `A3`) map to wrists in `scenes/cast.yaml`. |
| **Sound** | What a wrist plays in a scene: a patch name plus optional `params` and `level` (dB). `silence` is a sound. |
| **Two-hand sound** | A sound assigned to a performer (`Z` or `C`) rather than a wrist. It loads on the performer's left-wrist slot with the right wrist's device exposed as `~partner`; the right wrist's slot gets `silence`. Patch names end in `2H`. |
| **Scene** | A named step in the cue list: `id` (A, B, C … like PatchMarks letters, though nothing links them), `name`, `fade` seconds, and a sound per wrist or performer. A wrist not mentioned keeps its sound. |
| **Cue** | A pedal press (or page button) that moves to the next or previous scene. |
| **Transition** | The window after a cue during which a wrist has an **outgoing** and an **incoming** sound both live. Outside a transition each wrist has exactly one sound. |
| **Slot** | An AirKit device slot, 1–9. Two per wrist plus one audition slot. Never in the scenes file or the Perform page; Admin shows them in diagnostics only. |
| **Patch** | An AirKit personality file, `personalities/COS_<Name>.sc` on the `AirConditions` branch. |
| **Roster** | `lists/list_conditions.sc`, the personality list AirKit indexes into. |
| **Take** | A recorded, replayable IMU stream from one wrist with a label (e.g. `Z_scales_slow`). |

## 4. Repo layout and git strategy

```
ConditionsOfStillness/                 piece repo (git init here; this folder already holds scores, plugins, docs)
  airkit/                              git worktree of ~/AirKit on branch AirConditions   (gitignored)
  runner/                              Node/TypeScript runner + pages
  scenes/
    conditions.yaml                    the cue list
    cast.yaml                          stick hardware IDs → wrists; pedal mapping
  samples/COS_<Name>/                  audio Ciaran downloads (audio gitignored; SHOPPING.md, SOURCES.md, manifest.json committed)
  takes/                               recorded wrist takes (gitignored) + INDEX.md (committed)
  patching/
    profile.md                         the piece profile the skill reads
    context/                           programme note, per-scene descriptions (Ciaran)
    notes/COS_<Name>.md                research note per patch
    corpus/                            mined Steph personalities (raw gitignored; INDEX.md + index.json + digest.md committed)
    tools/                             corpus-mine, patch-lint, patch-compile, take-record, patch-audition, samples-check
    TEMPLATE.sc                        the piece's runnable patch skeleton
  .claude/skills/airkit-patch/         the generic skill (SKILL.md, references/, assets/)
  scores/  plugins/  assets/           existing
  docs/superpowers/{specs,plans}/      existing + new
  brainstorms/conditions-of-stillness/ session log per the brainstorm skill
  setup.sh  run.sh  README.md  .gitignore
```

### Git
- **Piece repo**: this folder. Private GitHub repo under Ciaran's account (created by hand or by
  a git push with existing credentials; `gh` is not installed).
- **AirKit branch**: `AirConditions`, created from `origin/AirConcert` (currently `3703cae`) in
  Ciaran's existing clone `~/AirKit`, checked out as a **git worktree** at `airkit/`. `~/AirKit`
  itself stays on `AirConcert`, clean, exactly as Glimmer and COTF expect.
- **Upstream discipline** on the branch (from AirKit `CLAUDE.md`): additive only; OSC changes
  update `code3.0/API.md` in the same commit; piece-specific code under `code3.0/conditions/`;
  shared-controller edits are environment-driven with defaults preserving today's behaviour;
  commits prefixed `cos:`. Never rebase or force-push; rebase onto new `AirConcert` commits only
  by explicit choice (a `scripts/airkit-rebase.sh` helper, as COTF's lab did).
- **Private mirror**: a GitHub *fork* of a public repo cannot be private, so the branch is pushed
  to a **private repo** under Ciaran's account (`ciaranframe/AirKit-conditions`) added as remote
  `mirror`. `origin` stays `sohla/AirKit`. Ciaran already has push rights on `sohla/AirKit`, so
  "going upstream" later is `git push origin AirConditions` and a conversation with Steph.
- The piece repo records the AirKit commit it was tested against in `airkit.lock` (branch + sha);
  `setup.sh` clones the mirror at that sha when `~/AirKit` is absent, or adds the worktree when
  it is present.

## 5. Engine profile (`airkit/code3.0/conditions/`)

Entry `main_conditions.scd` + `config.scd`, modelled on `code3.0/cotf/main_cotf.scd`: headless,
environment-driven, boots the unchanged `personalityController.scd` and `oscController.scd`, no
conductor (stub variables as in Glimmer's `glimmer_main.scd`: `~roomState = \idle`, `~beatClock`,
`~stateCtx`, `~scoreBeatsPerBar`, `~scoreEventsPerBeat`, `~stop`, `~onResync`). Stereo out
(`numOutputBusChannels = 2`), `blockSize 128`, `s.latency 0.05`, `numBuffers 2048`,
`memSize 65536`. sc3-plugins are allowed (they must be installed; `setup.sh` checks).

### Shared-controller edits (both additive, default-preserving, env-driven)
1. `oscController.scd:11` — `var numAirwareVirtualDevices = ("AIRKIT_VIRTUAL_DEVICES".getenv ? "5").asInteger;`
   Conditions sets 9.
2. `personalityController.scd:10` — `var list = "AIRKIT_LIST".getenv ? "list_cotf.sc";`
   Conditions sets `list_conditions.sc`.
Both are documented in `API.md` under a `[COS]` heading as configuration, not OSC.

### Slots
| Slot | Owner | Role |
|---|---|---|
| 1, 2 | ZL | pair |
| 3, 4 | ZR | pair |
| 5, 6 | CL | pair |
| 7, 8 | CR | pair |
| 9 | audition | used only by `patch-audition.ts` and Admin's per-wrist audition; own monitor |

The runner forwards each wrist's IMU stream to **both** of its slots at all times, from a fixed
source port (`9001`), so AirKit keys slot *n* as device port `9001 + n − 1` (same rule as COTF).

### Audio graph
- Each slot has a private stereo `Bus`; the profile fills `topEnvironment[\cotfSeatBus]` (slot →
  Bus) so the unchanged personality controller hands every patch its `~outBus`.
- Per wrist, one **wrist monitor** `Synth` (`\cosWristMonitor`) at the tail: reads the two slot
  buses, `XFade2`-style equal-power crossfade on `pos` (−1 = first slot, +1 = second slot) with
  `pos.lag(fadeSec)`, then `level` (linear, lagged), then sums to the master bus.
- Slot 9 has its own monitor (`\cosAuditionMonitor`, plain gain).
- Master stage `\cosMaster`: `masterGain` (lagged) then a `Limiter.ar` safety (−1 dBFS ceiling,
  disable with `COS_LIMITER=0`) to hardware out 0/1.
- Per-wrist `SendPeakRMS` taps pre-level on the crossfaded signal; the profile broadcasts
  `/airkit/cos/levels` to the last runner address at 10 Hz.

### OSC additions (all `[COS]` in `API.md`)
| Address | Args | Semantics |
|---|---|---|
| `/airkit/cos/xfade` | `wrist pos fadeSec` | `wrist` ∈ ZL/ZR/CL/CR as string; `pos` 0 = first slot, 1 = second slot; the monitor lags to it over `fadeSec`. |
| `/airkit/cos/level` | `wrist gainLinear fadeSec` | scene level for the wrist. |
| `/airkit/cos/master` | `gainLinear fadeSec` | master. |
| `/airkit/cos/params` | `slot k v k v …` | stores `topEnvironment[\cosSlotParams][slot]` (Event; values numbers or strings); if the slot has an env, `d.env.use { ~onSceneParams.(params) }`. |
| `/airkit/cos/partner` | `slot partnerSlot` (0 = none) | stores `topEnvironment[\cosSlotPartner][slot]`; if the slot has an env, sets `d.env[\partner]` to the partner device. |
| `/airkit/cos/audition` | `wrist` | tells the profile which wrist's IMU the runner is currently mirroring to slot 9 (informational, for status). |
| `/airkit/cos/getStatus` | — | replies `/airkit/cos/status/reply` with a JSON string: per slot `{name, tickAgeMs}` (age of the last completed tick; a dead tick loop shows as a growing age), per wrist `{pos, level}`, `master`, `serverCpu`, `limiterActive`. |
| `/airkit/cos/levels` | broadcast 10 Hz | `ZLpeak ZLrms ZRpeak … masterPeak masterRms`. |
| `/airkit/cos/panic` | — | every wrist level → 0 over 0.2 s, then `loadPersonality slot 0` for all 9 slots. |

Existing calls used unchanged: `/airkit/loadPersonality slotPort index`, `/airkit/getRoster`,
`/airkit/getSeats`, `/airkit/personalityName` (broadcast, used as load confirmation),
`/airkit/reLoadPersonality`.

### Patch contract additions (documented in the profile and the skill's `engine.md`)
- `~sceneParams`: read `topEnvironment[\cosSlotParams][d.index]` in `~init` (params may arrive
  before load) and implement `~onSceneParams = { |p| … }` for later updates. Absent keys mean
  defaults; every patch must run correctly with no params.
- `~partner`: nil for one-hand sounds. For `2H` patches, the other wrist's device
  (`~partner.sensors.*`, and its `~model` is **not** available — the patch smooths partner data
  itself or reads `topEnvironment[\devices][partnerPort].env[\model]` if that slot has a patch).
- Room state is always `\idle`; `~idleNext` is the patch. `~onRoomState` must still handle
  `\silent` (unchanged upstream contract).
- Crossfade-aware exit: because a wrist monitor may hold a slot at gain 0 for a long time while a
  patch is preloaded, a patch must be cheap when unheard, must not accumulate state that explodes
  on first hearing, and must be silent within ~200 ms of `~deinit` (unchanged).

### Load and fade sequence (runner-driven; the engine is stateless beyond what is listed)
1. Runner decides the wrist's **standby slot** (the one the crossfader is not on).
2. `/airkit/cos/params standby …`, `/airkit/cos/partner standby …`, then
   `/airkit/loadPersonality standbyPort index`. Confirmation = `/airkit/personalityName` broadcast
   or the next `/airkit/getSeats` reply naming the patch.
3. On cue: `/airkit/cos/level wrist sceneLevel fade` and `/airkit/cos/xfade wrist pos fade`.
4. After `fade` elapses: `/airkit/loadPersonality outgoingPort 0` (silence).
5. Immediately preload the next scene's incoming sound for that wrist into the now-free slot
   (step 2) so the next cue is instant.
Fast presses: a cue arriving mid-fade for the same wrist first completes the running fade in
0.1 s, runs step 4, then starts the new transition. Back behaves exactly like next with the
previous scene as target.

## 6. Runner (`runner/`)

Node ≥ 22 with TypeScript run directly (`node --experimental-strip-types` or Node 23+ native), no
framework. Vendored Preact + htm for the pages (as Glimmer). Copied in with attribution from
Glimmer's `code/show-engine`: `src/osc/codec.ts`, `test/fake-airkit.ts`, and the liveness and
reconciliation ideas from `src/sticks/airkit.ts`. No dependency on the Glimmer repo.

### Inputs
- **Sticks**: UDP listener for `/N/IMUFusedData`, `/N/Battery`, `/N/DigiIn`. `cast.yaml` maps
  `(sourceIp, N)` or the stick's printed ID to a wrist. Every wrist packet is re-emitted twice to
  AirKit's sclang port as `/slot/…` from source port 9001; when Admin auditions on a wrist, a
  third copy goes to slot 9.
- **Pedal**: MIDI via `@julusian/midi` (the package Glimmer's show engine already uses). `cast.yaml` names the port match and
  the note/CC for `next` and `back`. Debounce 150 ms. Also: keyboard (space/right = next,
  left = back on Perform; same on Admin), and page buttons.
- **AirKit**: polls `/airkit/getRoster`, `/airkit/getSeats`, `/airkit/cos/getStatus` every 2 s;
  offline after 3 missed polls; on dead→alive re-pushes the current scene fully.

### Scenes file (`scenes/conditions.yaml`)
```yaml
piece: Conditions of Stillness
defaults: { fade: 2.0, level: 0 }        # level in dB
scenes:
  - id: A
    name: Opening stillness
    fade: 6.0
    sounds:
      ZL: { patch: COS_Breath, params: { register: low } }
      ZR: COS_Breath
      CR: { patch: COS_Skin, level: -6 }
  - id: B
    name: First strike
    fade: 0.1
    sounds:
      C: COS_Membrane2H            # two-hand: C means both CL and CR
```
Validation on load: unique ids; every patch name in the roster (checked live against AirKit when
online, else against `airkit/lists/list_conditions.sc`); `2H` patches only on `Z`/`C`; non-`2H`
only on wrists; fade 0.05–30; params scalar values only. Errors are shown on Admin and the file is
re-read on change (chokidar-free: `fs.watch` with a 200 ms debounce).

### State
- `sceneIndex` persisted to `runner/state/current.json` on every change; on start, the runner
  reads it and reconciles against AirKit's actual seats (re-push if different).
- Per wrist: `{ current: Sound, incoming?: Sound, outgoingSlot, incomingSlot, fadeEndsAt }`.
- The engine holds nothing the runner cannot recompute.

### Pages (HTTP + WebSocket, one port, printed by `run.sh`)
- **Perform** `/perform` — for Zubin at the piano: black background, very large scene letter and
  name, next scene letter and name, four wrist labels (ZL ZR CL CR with sound names), transition
  progress bar, pedal flash, Next/Back buttons. No controls beyond that.
- **Admin** `/admin` — for Ciaran on an iPad at the desk: cue list with jump-to-any-scene,
  per-wrist meters and level faders, master fader, stick liveness and battery per wrist, AirKit
  online/CPU/limiter, slot diagnostics, pedal mapping test, per-wrist audition picker (roster
  list; loads into slot 9 mirroring that wrist), reload-patch, panic, log tail, and a mirror of
  the Perform view.
- Admin actions are guarded against accidental taps (confirm on jump and panic).

**Locked visual design (2026-09-26, mockup https://claude.ai/artifact/DdTVyHA4x2BFFuGCGrxYT1):**
cockpit, not craft. Black ground, white text, plain heavy sans (IBM Plex Sans) and mono
(IBM Plex Mono); no serif, no decorative accent. Colour carries meaning only: green = ok,
amber = changing or warning, red = fault, grey = inert. Perform: a status strip of solid
cells across the top (PEDAL, STICKS n/4, AIRKIT, AUDIO, BATTERY, clock); "SCENE D" with
the letter as the dominant element and the name beside it; NEXT and PREVIOUS as labelled
boxes; sticks shown by their real hardware names from `cast.yaml` (performer and hand in
small text), each with patch name, a state tag (OK / FADING nn% / SILENT / NO SIGNAL) and
battery; buttons read "BACK TO C" and "NEXT: SCENE E". Admin: same status strip, scene list
with NOW/NEXT tags, stick strips by real name with meter and level, slots and engine
panels, master, red PANIC.

### Tests (`runner/test/`, `node --test`)
Scene file validation; the transition state machine including press-mid-fade, back at scene A,
next at the last scene, two-hand assignment freeing the right wrist; OSC forwarding and slot
mapping; reconciliation on runner restart and on AirKit dead→alive; pedal mapping. All against
`fake-airkit.ts`.

## 7. Patch skill and tooling

### The skill (`.claude/skills/airkit-patch/`)
Generic. Reads the **piece profile** named in its invocation (default: `patching/profile.md` of
the current repo). Steps in `SKILL.md`: read profile + `patching/context/` → read the brief like a
composer → six-track research (parallel subagents) → design and write the note → write the patch
atomically from the profile's `TEMPLATE.sc` → compile-check → lint → roster → audition → samples
step if the header declares slots → hand-off → iterate on notes.

References: `engine.md` (contract, lifecycle, hooks, gesture model — consolidated from COTF's
`BIBLE.md`, Steph's `personality_authoring.md` / `concert_p_files.md`, Glimmer's `bible.md`, with
`file:line` citations re-checked against the `AirConditions` branch), `patterns.md` (idioms incl.
two-hand, scene params, crossfade-aware exit, energy tiers, stillness reveals, direction),
`pitfalls.md` (union), `research.md` (six tracks: A physics, B synthesis prior art, C musical
world, D gesture/mapping, **E SuperCollider practice**, **F Steph's corpus**), `samples.md`,
`profile-schema.md`.

### The piece profile (`patching/profile.md`)
Instrument context (wrist-worn sticks on a pianist and a bass drummer; what playing looks like
to the IMU; playing vs free gesture; the non-playing hand; rest as a musical state), naming
(`COS_<UpperCamel>`, `2H` suffix), roster path, scene-parameter contract and recommended keys
(`register`, `density`, `brightness`, `pitchset`, `rate`, `wet`), level plan (stereo PA, peaks
−12…−6 dBFS shaken hard, ensemble must still be heard), plugins allowed (sc3-plugins), audition
slot 9, takes location, hand-off format (gestures described in piano and drum terms), where
context lives.

### Tools (`patching/tools/`)
| Tool | Does |
|---|---|
| `corpus-mine.ts` | `git ls-tree`/`git show` every `personalities/*.sc` (and `synths/`) on every AirKit branch, read-only, into `patching/corpus/<branch>/`; builds `index.json` + `INDEX.md` (branch, name, header keys, UGens used, idiom Pdef/Ndef/Synth/hybrid, gesture fields read, thresholds/tiers, sample use, size) and `digest.md` (recurring logics with pointers). Raw files gitignored, index and digest committed. |
| `patch-lint.ts` | Glimmer's linter adapted: profile-driven prefix, roster path, allowed classes incl. installed sc3-plugins (from the local Extensions dir), `~onSceneParams`/`~partner` rules for `2H`. |
| `patch-compile.sh` | headless sclang parse check of a `.tmp` before `mv`. |
| `take-record.ts` | records a wrist's raw OSC to `takes/<label>.take.jsonl` with timestamps; `takes/INDEX.md` lists labels. |
| `patch-audition.ts` | loads a patch into slot 9, replays named takes (or synthetic sway/shake/tilt/still phases), reports interpreter errors from the sclang log, peak/RMS per phase from `/airkit/cos/levels`, and silence on unload. |
| `samples-check.ts` | see §8. |
| `engine-smoke.ts` | boots the profile headless on spare ports, loads `silence` and the template into every slot, checks `getStatus`, exits non-zero on any error line. |

### Corpus facts (2026-09-26)
`origin/Airsticks-RPI` 233 personalities, `Airsticks-Desktop` 187, `MiMBrentonShows` 130,
`master` 71, `AirConcert` 32. Mining is read-only via git objects; nothing is checked out.

## 8. Samples workflow
1. The patch header declares `samples: [slotName: "what", …]`.
2. The skill writes `samples/COS_<Name>/SHOPPING.md`: per slot — what to look for, target length,
   mono/stereo, pitched or not, sample-rate note, suggested search terms (Freesound etc.), licence
   requirement (CC0 / CC-BY / own recording).
3. Ciaran downloads into that folder with any filenames and tells the skill (or runs the check).
4. `samples-check.ts`: assigns files to slots (by name prefix `slotName-*` or interactively),
   validates readability, channels and length, converts with ffmpeg to 48 kHz WAV (mono when the
   slot says so) into `samples/COS_<Name>/wav/`, writes `manifest.json` (`slot → file, frames,
   channels, sr`) and a `SOURCES.md` skeleton (file, URL, author, licence) for Ciaran to complete.
5. The patch loads by slot name from the manifest via `topEnvironment[\cosSamples]` (set by
   `config.scd` to the piece's `samples/` folder). Audio is gitignored; `SHOPPING.md`,
   `manifest.json`, `SOURCES.md` are committed. The lint fails if the patch reads any path not
   under `~cosSamples`.

## 9. Transport and setup
- `setup.sh` (fresh Mac): checks SuperCollider ≥ 3.13 at `/Applications/SuperCollider.app`,
  installs sc3-plugins 3.14 into `~/Library/Application Support/SuperCollider/Extensions/` if
  missing (strips `._*` files), checks ffmpeg, `npm ci` in `runner/` and `patching/tools/`,
  obtains AirKit: worktree from `~/AirKit` if present, else clone of the `mirror` remote at
  `airkit.lock`'s sha into `airkit/`; checks `samples/*/manifest.json` against files and prints
  what is missing; prints the network checklist.
- `run.sh`: starts sclang on `main_conditions.scd` under a restart loop with a log at
  `~/.conditions/airkit.log`, then the runner; prints Perform and Admin URLs; Ctrl-C stops both
  and the scsynth child (Glimmer's trap pattern).
- Network: a dedicated access point + router; the laptop on a fixed IP; sticks configured to
  stream to it (`/Config/RequestStream`); the iPad on the same network. Documented in `README.md`.
- Machine facts (2026-09-26, this laptop): SuperCollider 3.13.0; Extensions has only
  `Quaternion.sc` (no sc3-plugins, no quarks — the headless profile needs no quarks); Node 26.5;
  ffmpeg present; sox absent; no MIDI pedal connected yet; `gh` not installed.

## 10. Verification
- Runner unit tests (§6) in CI-less `npm test`.
- `engine-smoke.ts` as the engine gate for every branch commit.
- `patch-audition.ts` as the per-patch gate; real takes once recorded (reminder: record piano
  scales/chords/tremolo/octaves, bass drum strokes/rolls/damping, stillness, for both wrists).
- First-rehearsal checklist in `docs/rehearsal-checklist.md`: sticks stream, wrists mapped,
  pedal next/back, a two-scene crossfade heard, Admin reachable from the iPad, panic works.

## 11. Decisions log (session 1, 2026-09-26)
| Decision | Reasoning |
|---|---|
| Free time, no conductor | The piece is notated and cued; gesture is the only clock. |
| Scenes file only, no score link | Keeps runner and score independent; PatchMarks letters mirror scene ids by convention. |
| Per-wrist and two-hand sounds, scene decides | Both are musically wanted; two-hand costs one `~partner` hook. |
| Both patches live during a fade | True instrument crossfade; CPU cost only around transitions thanks to preloading. |
| Slot pairs in one AirKit (A1) over two instances | Two-hand across processes impractical; one env-driven device-count edit is cheap. |
| Node owns the show, SC is the engine (B1) | One source of truth; runner restart cannot desync audio; browser pages are easy. |
| Generic skill + profile (C1) | Glimmer and COTF can adopt it; piece specifics stay in one file. |
| Piece repo here + AirKit worktree | Steph's repo gets only patches, roster and profile; Sibelius files stay here. |
| Private mirror repo, not a GitHub fork | Forks of public repos cannot be private. Ciaran has push rights upstream anyway. |
| sc3-plugins allowed | Richer palette; setup installs them; lint checks installed classes. |
| Shopping-list samples | Ciaran chooses sounds by ear; the skill specifies and wires. |
| Tooling and skill before patches | Chosen by Ciaran; runway is a few months. |
| Slot 9 audition | Tools and Admin can test without touching a wrist mid-rehearsal. |

## 12. Open questions
- Which MIDI footswitch (needs two switches; USB or Bluetooth MIDI). Decide before rehearsal 1.
- Whether the performance laptop is this one (SC 3.13, no plugins yet) or another.
- Scene-parameter vocabulary will grow with the first patches; the profile lists recommended keys
  but the runner passes any scalar through.
- Whether Zubin also wants a small physical display rather than the laptop screen.

## 13. Risks
- **Half-written file hot-reload** (upstream mtime poll): all tools write `.tmp` then `mv`.
- **Tick-loop death on an error in a hook**: lint + audition gate; Admin shows a slot whose tick
  has stopped (`getStatus` carries `tickAgeMs` per slot).
- **Standby-slot patches accumulating state while unheard**: the profile's crossfade-aware exit
  rule; audition includes a "preloaded 60 s then heard" phase.
- **Steph's branch moves**: rebase only by explicit choice via a helper; the two shared-controller
  edits are tiny and default-preserving.
- **Cloud-synced `~/Documents` mangles symlinks and duplicates files**: no symlink overlay is used
  (worktree instead); tools skip `Name 2.sc` duplicates; audio and takes are gitignored.
