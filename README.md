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
- `npm run smoke:runner` — the same private engine driven by the real runner, fake sticks and
  WebSocket cues.
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

First rehearsal: `docs/rehearsal-checklist.md`.
