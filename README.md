# Conditions of Stillness — AirStick system

A composed piece for two AirStick-wearing performers (Zubin, piano; Claire, bass drum; one stick
on each wrist) and a chamber ensemble. Scenes assign a sound to each wrist and crossfade on a
footswitch cue. Design: `docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md`.

## Layout
| Path | What |
|---|---|
| `airkit/` | git worktree of AirKit on branch `AirConditions` (gitignored; created by `setup.sh`) |
| `airkit.lock` | branch, sha, upstream and private mirror the piece was tested against |
| `runner/` | the show runner (Node): stick ingest, cues, engine link, Perform and Admin pages |
| `scenes/` | `conditions.yaml` cue list, `cast.yaml` stick, pedal and port mapping |
| `patching/` | piece profile, context, notes, corpus index, tools (sub-project 4) |
| `samples/` | audio per patch, downloaded per `SHOPPING.md`; audio gitignored |
| `takes/` | recorded wrist takes for auditioning; audio gitignored, `INDEX.md` committed |
| `scores/`, `plugins/` | the Sibelius score and the PatchMarks plugin |
| `scripts/` | `setup.ts` (behind `setup.sh`), `airkit-rebase.sh`, tests |
| `brainstorms/` | session logs |
| `docs/` | specs, plans, `rehearsal-checklist.md` |

## Setup on a Mac
```
./setup.sh --check     # report only
./setup.sh             # install what is missing (SuperCollider must be installed by hand)
npm test
```
Prerequisites installed by hand: SuperCollider ≥ 3.13 (`/Applications/SuperCollider.app`),
Node ≥ 22.18, Homebrew `ffmpeg`. `setup.sh` installs sc3-plugins 3.14.0, prepares the AirKit
worktree (from `~/AirKit` when present, else from the private mirror), and installs Node deps.
Until the private mirror holds the branch, a second Mac must get `~/AirKit` by copying it from
this one; `./setup.sh --check` reports whether the mirror is reachable.

## Working on the AirKit branch
- Work in `airkit/` (branch `AirConditions`); `~/AirKit` stays on `AirConcert`, untouched.
- Commits prefixed `cos:`; additive only; OSC changes update `airkit/code3.0/API.md` in the same commit.
- Push to the private mirror: `git -C airkit push mirror AirConditions`. The mirror is a private HTTPS repo under ciaranframe; credentials come from the macOS keychain. Never push to `origin`
  unless offering the branch to Steph on purpose.
- Take in Steph's new commits: `scripts/airkit-rebase.sh --dry-run`, then without the flag; then
  update `sha=` in `airkit.lock`.

## Network at the venue
- Dedicated access point + router for the piece. Laptop on a fixed IP on that network.
- Each stick streams to the **runner's** UDP port 8000 on the laptop, not to sclang:
  `/Config/RequestStream <laptop ip bytes> 8000` (see `airkit/configureAirStickOSC.sc`). The
  runner maps stick ids to wrists and forwards each wrist to the engine from source port 9001.
- The iPad for the Admin page joins the same network; the runner prints the URLs.

## Running
- `./run.sh` — starts both processes, each under its own restart loop: the engine (AirKit
  profile `airkit/code3.0/conditions/main_conditions.scd`, log `~/.conditions/airkit.log`) and
  the runner (`node runner/src/main.ts`, log `~/.conditions/runner.log`). Ctrl-C stops sclang,
  scsynth and the runner. `COS_OUT_DEVICE="MacBook Pro Speakers" ./run.sh` pins the output device;
  `COS_STICK_PORT`, `COS_WEB_PORT`, `COS_SOURCE_PORT`, `COS_AIRKIT_HOST`, `COS_STATE_PATH`
  override the runner's ports and state file.
- `npm --prefix runner run dev:fake` — the runner against a fake engine (port 57140) and four fake
  sticks (ids 1–4), to look at the pages without SuperCollider or sticks. It uses a temp copy of
  `cast.yaml` (path printed at start), so stick assignments made there leave the repo untouched.
- `node scripts/engine-ping.ts` — prints roster, seats, state and `[COS]` status of a running engine.
- `npm run smoke` — boots a private engine on ports 57130/57131, drives it with fake sticks and
  checks the `[COS]` contract end to end (audible for ~10 s). Safe while a real engine runs.
- `npm run smoke:runner` — the same private engine (57130/57131) driven by the real runner (sticks
  8010, pages 3010), fake sticks and WebSocket cues: standby preload, cues, live params, panic/resume,
  audition (~15 s warm). Logs `~/.conditions/runner-smoke.log` (engine) and `runner-smoke.runner.log`.
  Safe while a real engine runs, not alongside a running runner or `npm run smoke` (all bind port 9001).
- OSC contract: `airkit/code3.0/API.md`, the `[COS]` sections.

## cast.yaml
`scenes/cast.yaml` says who is who. `sticks:` gives each wrist (ZL ZR CL CR) the stick's OSC id
(the N in `/N/IMUFusedData`), the label printed on the stick (shown on the pages), and an optional
IP that only warns on mismatch. Sticks can be assigned from Admin's STICKS HEARD panel instead of by
hand; the runner writes the file and reloads it. `pedal:` maps the footswitch, `network:` the ports
(sticks 8000, pages 3000, engine 127.0.0.1:57120, source port 9001). The runner reloads
`cast.yaml` and `conditions.yaml` when either is saved; a scenes file with errors is reported on
Admin and the previous scenes are kept. Port changes need a runner restart.

## Pages
- `http://<laptop>:3000/perform` — the performers' view: current and next scene, the four wrists,
  NEXT and BACK.
- `http://<laptop>:3000/admin` — the operator's view on the iPad: status strip, scene list and
  jump, trims and master, stick assignment, audition, reload, PANIC and RESUME, pedal, log.
- Keys on both pages: Space or → = next, ← = back.

## Pedal
Any two-switch MIDI footswitch. Plug it in and watch Admin's PEDAL panel: each press shows the note
or CC number it sends. Set those numbers as `pedal.next` and `pedal.back` in `cast.yaml` (and
`pedal.input` if more than one MIDI device is connected). Without a footswitch, the keys and the
page buttons cue the same way.

## Patching
Sounds are AirKit personalities, `airkit/personalities/COS_<Name>.sc`, written with the
`airkit-patch` skill (`.claude/skills/airkit-patch/SKILL.md`): in Claude Code,
`/airkit-patch <brief> [--profile patching/profile.md]`, e.g. `/airkit-patch a breath-like sound
for a still left hand over the keys`. The skill is generic; everything about this piece (names,
roster, template, level plan, hand-off format) comes from `patching/profile.md`. It stops for
Ciaran before any samples are downloaded and after the hand-off.

Workflow: **context** (profile + every file in `patching/context/`) → **research** (six tracks
in parallel: physics, synthesis prior art, musical world, gesture, SuperCollider practice,
Steph's corpus) → **note** (`patching/notes/COS_<Name>.md`) → **patch** (copied from
`airkit/personalities/COS_Template.sc`, written to a `.tmp` and moved into place — the engine
hot-loads on save; compile and lint check the `.tmp` before the move) → **compile** → **lint** →
**roster** → **audition** on slot 9 → **commit** `cos: …` in `airkit/`, push `mirror`, update
`airkit.lock` (only after `AUDITION PASS`) → **samples** (only if the header declares slots) →
**hand-off** in piano and drum terms → iterate on notes.

| Tool | Does | Command |
|---|---|---|
| `patch-compile.ts` | headless sclang parse check (~3 s), never executes the patch; takes the `.sc.tmp` before the `mv` | `npm run patch:compile -- <Name\|path>` |
| `patch-lint.ts` | static rules from the profile: header, naming, hooks, scene params, `~partner`, tick safety, sample paths, SynthDef names, unknown classes, roster | `npm run patch:lint -- <Name> [--json]` |
| `patch-roster.ts` | adds/removes/lists patches in `airkit/lists/list_conditions.sc`, atomically | `npm run patch:roster -- add\|remove <Name>` / `list` |
| `patch-audition.ts` | plays a patch on audition slot 9 with synthetic gestures or a take; peak/RMS per phase, server CPU, errors, silence on unload | `npm run patch:audition -- <Name> [--quick\|--long\|--take <label>] [--params k=v,…] [--rest-max <dBFS>]` |
| `take-record.ts` | records one wrist's IMU stream (UDP 8001; see below) to `takes/<label>.take.jsonl` | `npm run take:record -- <label> --wrist ZL [--seconds 30]` |
| `samples-check.ts` | matches downloaded files to `SHOPPING.md` slots, converts to 48 kHz WAV, writes `manifest.json` and `SOURCES.md` | `npm run samples:check -- COS_<Name>` |
| `corpus-mine.ts` | mines every AirKit branch's personalities from git objects into `patching/corpus/` | `npm run corpus:mine` |

Full flags and exit codes: `patching/tools/README.md`. The audition uses a running engine on
57120 if one answers, else boots a private one on 57130/57131; next to a live runner it never
touches slots 1–8, but it plays through the real output.

**Recording a take.** Two ways, same file (`takes/<label>.take.jsonl` + a row in `takes/INDEX.md`):

- **The take page** — `npm run take:page` then open http://localhost:3001/. It hears every stick
  streaming to udp **9000** (`--port` to change), shows the stick's id, ip, rate, battery and live
  |a|, and records with a label + what (space = record / stop). Takes are filed as **CF** (`--as`)
  unless a wrist is chosen — CF is the general filing for takes recorded on Ciaran's own wrist
  with an unassigned stick. `takes/PLAN.md` (a `| label | what |` table) lists the planned
  takes on the page; click a row to arm it, and the next undone row arms itself after a take.
- **The CLI** — `npm run take:record -- <label> --wrist ZL [--seconds 30] [--what "…"]` records
  that wrist's stick (its id from `scenes/cast.yaml`), or `--id X0 --as CF` an unassigned one,
  from udp **8001** (`--port`).

Which port depends on the stick's firmware, because a stick only ever sends where it was told:

- **AirKit sticks** (the four for the piece) stream to the runner on 8000 and can be repointed —
  from sclang, as in `airkit/configureAirStickOSC.sc`:
  `NetAddr("<stick ip>", 8888).sendMsg("/Config/RequestStream", <laptop ip as four numbers>, 8001)`,
  and back to 8000 afterwards (while repointed, the runner does not hear that wrist) — or stop
  the runner and record with `--port 8000`.
- **The Glimmer C-stick build** (`~/Documents/Glimmer/code/airstick-fw`, the blank stick that
  announces itself as `X0`) has no `/Config/` listener: it streams `/X0/IMUFusedData` to
  **192.168.0.107:9000** on the `AirClick` network, fixed at flash time. So this Mac must *be*
  192.168.0.107 there. With the AirClick cable in the USB Ethernet adapter and Wi-Fi left as it
  is (Wi-Fi stays first in the service order, so the internet is untouched):
  `networksetup -setmanual "USB 10/100/1G/2.5G LAN" 192.168.0.107 255.255.255.0 192.168.0.1`
  (admin password), check with `ifconfig en8`, and later `networksetup -setdhcp "USB 10/100/1G/2.5G LAN"`
  to undo. Then `npm run take:page` (9000 is its default) or `take:record -- … --id X0 --as CF --port 9000`.

If nothing arrives within 3 s the recorder says where it is listening; a take with no packets
writes nothing and exits 1. Labels are letters, digits and `_ . -`; an existing label is refused
unless `--force` (⌥-click RECORD on the page). Takes are replayed with
`npm run patch:audition -- <Name> --take <label>`.

| Path | What |
|---|---|
| `airkit/` | git worktree of AirKit on branch `AirConditions` (gitignored; created by `setup.sh`) |
| `airkit.lock` | branch, sha, upstream and private mirror the piece was tested against |
| `runner/` | the show runner (Node): stick ingest, cues, engine link, Perform and Admin pages |
| `scenes/` | `conditions.yaml` cue list, `cast.yaml` stick, pedal and port mapping |
| `patching/` | piece profile, context, notes, corpus index, tools (sub-project 4) |
| `samples/` | audio per patch, downloaded per `SHOPPING.md`; audio gitignored |
| `takes/` | recorded wrist takes for auditioning; audio gitignored, `INDEX.md` committed |
| `scores/`, `plugins/` | the Sibelius score and the PatchMarks plugin |
| `scripts/` | `setup.ts` (behind `setup.sh`), `airkit-rebase.sh`, tests |
| `brainstorms/` | session logs |
| `docs/` | specs, plans, `rehearsal-checklist.md` |

## Setup on a Mac
```
./setup.sh --check     # report only
./setup.sh             # install what is missing (SuperCollider must be installed by hand)
npm test
```
Prerequisites installed by hand: SuperCollider ≥ 3.13 (`/Applications/SuperCollider.app`),
Node ≥ 22.18, Homebrew `ffmpeg`. `setup.sh` installs sc3-plugins 3.14.0, prepares the AirKit
worktree (from `~/AirKit` when present, else from the private mirror), and installs Node deps.
Until the private mirror holds the branch, a second Mac must get `~/AirKit` by copying it from
this one; `./setup.sh --check` reports whether the mirror is reachable.

## Working on the AirKit branch
- Work in `airkit/` (branch `AirConditions`); `~/AirKit` stays on `AirConcert`, untouched.
- Commits prefixed `cos:`; additive only; OSC changes update `airkit/code3.0/API.md` in the same commit.
- Push to the private mirror: `git -C airkit push mirror AirConditions`. The mirror is a private HTTPS repo under ciaranframe; credentials come from the macOS keychain. Never push to `origin`
  unless offering the branch to Steph on purpose.
- Take in Steph's new commits: `scripts/airkit-rebase.sh --dry-run`, then without the flag; then
  update `sha=` in `airkit.lock`.

## Network at the venue
- Dedicated access point + router for the piece. Laptop on a fixed IP on that network.
- Each stick streams to the **runner's** UDP port 8000 on the laptop, not to sclang:
  `/Config/RequestStream <laptop ip bytes> 8000` (see `airkit/configureAirStickOSC.sc`). The
  runner maps stick ids to wrists and forwards each wrist to the engine from source port 9001.
- The iPad for the Admin page joins the same network; the runner prints the URLs.

## Running
- `./run.sh` — starts both processes, each under its own restart loop: the engine (AirKit
  profile `airkit/code3.0/conditions/main_conditions.scd`, log `~/.conditions/airkit.log`) and
  the runner (`node runner/src/main.ts`, log `~/.conditions/runner.log`). Ctrl-C stops sclang,
  scsynth and the runner. `COS_OUT_DEVICE="MacBook Pro Speakers" ./run.sh` pins the output device;
  `COS_STICK_PORT`, `COS_WEB_PORT`, `COS_SOURCE_PORT`, `COS_AIRKIT_HOST`, `COS_STATE_PATH`
  override the runner's ports and state file.
- `npm --prefix runner run dev:fake` — the runner against a fake engine (port 57140) and four fake
  sticks (ids 1–4), to look at the pages without SuperCollider or sticks. It uses a temp copy of
  `cast.yaml` (path printed at start), so stick assignments made there leave the repo untouched.
- `node scripts/engine-ping.ts` — prints roster, seats, state and `[COS]` status of a running engine.
- `npm run smoke` — boots a private engine on ports 57130/57131, drives it with fake sticks and
  checks the `[COS]` contract end to end (audible for ~10 s). Safe while a real engine runs.
- `npm run smoke:runner` — the same private engine (57130/57131) driven by the real runner (sticks
  8010, pages 3010), fake sticks and WebSocket cues: standby preload, cues, live params, panic/resume,
  audition (~15 s warm). Logs `~/.conditions/runner-smoke.log` (engine) and `runner-smoke.runner.log`.
  Safe while a real engine runs, not alongside a running runner or `npm run smoke` (all bind port 9001).
- OSC contract: `airkit/code3.0/API.md`, the `[COS]` sections.

## cast.yaml
`scenes/cast.yaml` says who is who. `sticks:` gives each wrist (ZL ZR CL CR) the stick's OSC id
(the N in `/N/IMUFusedData`), the label printed on the stick (shown on the pages), and an optional
IP that only warns on mismatch. Sticks can be assigned from Admin's STICKS HEARD panel instead of by
hand; the runner writes the file and reloads it. `pedal:` maps the footswitch, `network:` the ports
(sticks 8000, pages 3000, engine 127.0.0.1:57120, source port 9001). The runner reloads
`cast.yaml` and `conditions.yaml` when either is saved; a scenes file with errors is reported on
Admin and the previous scenes are kept. Port changes need a runner restart.

## Pages
- `http://<laptop>:3000/perform` — the performers' view: current and next scene, the four wrists,
  NEXT and BACK.
- `http://<laptop>:3000/admin` — the operator's view on the iPad: status strip, scene list and
  jump, trims and master, stick assignment, audition, reload, PANIC and RESUME, pedal, log.
- Keys on both pages: Space or → = next, ← = back.

## Pedal
Any two-switch MIDI footswitch. Plug it in and watch Admin's PEDAL panel: each press shows the note
or CC number it sends. Set those numbers as `pedal.next` and `pedal.back` in `cast.yaml` (and
`pedal.input` if more than one MIDI device is connected). Without a footswitch, the keys and the
page buttons cue the same way.

## Patching
Sounds are AirKit personalities, `airkit/personalities/COS_<Name>.sc`, written with the
`airkit-patch` skill (`.claude/skills/airkit-patch/SKILL.md`): in Claude Code,
`/airkit-patch <brief> [--profile patching/profile.md]`, e.g. `/airkit-patch a breath-like sound
for a still left hand over the keys`. The skill is generic; everything about this piece (names,
roster, template, level plan, hand-off format) comes from `patching/profile.md`. It stops for
Ciaran before any samples are downloaded and after the hand-off.

Workflow: **context** (profile + every file in `patching/context/`) → **research** (six tracks
in parallel: physics, synthesis prior art, musical world, gesture, SuperCollider practice,
Steph's corpus) → **note** (`patching/notes/COS_<Name>.md`) → **patch** (copied from
`airkit/personalities/COS_Template.sc`, written to a `.tmp` and moved into place — the engine
hot-loads on save; compile and lint check the `.tmp` before the move) → **compile** → **lint** →
**roster** → **audition** on slot 9 → **commit** `cos: …` in `airkit/`, push `mirror`, update
`airkit.lock` (only after `AUDITION PASS`) → **samples** (only if the header declares slots) →
**hand-off** in piano and drum terms → iterate on notes.

| Tool | Does | Command |
|---|---|---|
| `patch-compile.ts` | headless sclang parse check (~3 s), never executes the patch; takes the `.sc.tmp` before the `mv` | `npm run patch:compile -- <Name\|path>` |
| `patch-lint.ts` | static rules from the profile: header, naming, hooks, scene params, `~partner`, tick safety, sample paths, SynthDef names, unknown classes, roster | `npm run patch:lint -- <Name> [--json]` |
| `patch-roster.ts` | adds/removes/lists patches in `airkit/lists/list_conditions.sc`, atomically | `npm run patch:roster -- add\|remove <Name>` / `list` |
| `patch-audition.ts` | plays a patch on audition slot 9 with synthetic gestures or a take; peak/RMS per phase, server CPU, errors, silence on unload | `npm run patch:audition -- <Name> [--quick\|--long\|--take <label>] [--params k=v,…] [--rest-max <dBFS>]` |
| `take-record.ts` | records one wrist's IMU stream (UDP 8001; see below) to `takes/<label>.take.jsonl` | `npm run take:record -- <label> --wrist ZL [--seconds 30]` |
| `samples-check.ts` | matches downloaded files to `SHOPPING.md` slots, converts to 48 kHz WAV, writes `manifest.json` and `SOURCES.md` | `npm run samples:check -- COS_<Name>` |
| `corpus-mine.ts` | mines every AirKit branch's personalities from git objects into `patching/corpus/` | `npm run corpus:mine` |

Full flags and exit codes: `patching/tools/README.md`. The audition uses a running engine on
57120 if one answers, else boots a private one on 57130/57131; next to a live runner it never
touches slots 1–8, but it plays through the real output.

**Recording a take.** `npm run take:record -- <label> --wrist ZL [--seconds 30] [--what "…"]`
records that wrist's stick (its id from `scenes/cast.yaml`) from UDP **8001**. The sticks
normally stream to the runner on 8000, so either repoint one stick at 8001 for the take — from
sclang, as in `airkit/configureAirStickOSC.sc`:
`NetAddr("<stick ip>", 8888).sendMsg("/Config/RequestStream", <laptop ip as four numbers>, 8001)`,
and back to 8000 afterwards (while repointed, the runner does not hear that wrist) — or stop the
runner and record with `--port 8000`. If nothing arrives within 3 s the recorder says where it is
listening; a take with no packets writes nothing and exits 1. Labels are letters, digits and
`_ . -`; an existing label is refused unless `--force`. Takes are listed in `takes/INDEX.md` and
replayed with `npm run patch:audition -- <Name> --take <label>`.

| Path | What |
|---|---|
| `patching/profile.md` | the piece profile the skill and lint read |
| `patching/context/` | programme note, scene notes — read in full before every patch |
| `patching/notes/` | one research note per patch; `EXAMPLE.md` is the worked example of the research stage |
| `patching/corpus/` | `index.json`, `INDEX.md`, `stats.md`, `digest.md` (committed); raw mined files per branch (gitignored, main checkout only). Re-mine with `npm run corpus:mine` |
| `samples/COS_<Name>/` | `SHOPPING.md`, `manifest.json`, `SOURCES.md` committed; audio gitignored |
| `takes/` | `<label>.take.jsonl` gitignored; `INDEX.md` and `PLAN.md` committed |

First rehearsal: `docs/rehearsal-checklist.md`.
