# Conditions of Stillness — AirStick system

A composed piece for two AirStick-wearing performers (Zubin, piano; Claire, bass drum; one stick
on each wrist) and a chamber ensemble. Scenes assign a sound to each wrist and crossfade on a
footswitch cue. Design: `docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md`.

## Layout
| Path | What |
|---|---|
| `airkit/` | git worktree of AirKit on branch `AirConditions` (gitignored; created by `setup.sh`) |
| `airkit.lock` | branch, sha, upstream and private mirror the piece was tested against |
| `runner/` | the show runner and its Perform and Admin pages (sub-project 3) |
| `scenes/` | `conditions.yaml` cue list, `cast.yaml` stick and pedal mapping (sub-project 3) |
| `patching/` | piece profile, context, notes, corpus index, tools (sub-project 4) |
| `samples/` | audio per patch, downloaded per `SHOPPING.md`; audio gitignored |
| `takes/` | recorded wrist takes for auditioning; audio gitignored, `INDEX.md` committed |
| `scores/`, `plugins/` | the Sibelius score and the PatchMarks plugin |
| `scripts/` | `setup.ts` (behind `setup.sh`), `airkit-rebase.sh`, tests |
| `brainstorms/` | session logs |

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
- Each stick streams to the laptop's IP and sclang port (`/Config/RequestStream`, see
  `airkit/configureAirStickOSC.sc`).
- The iPad for the Admin page joins the same network; the runner prints the URLs.

## Running
- `./run.sh` — starts the engine (AirKit profile `airkit/code3.0/conditions/main_conditions.scd`)
  under a restart loop; log at `~/.conditions/airkit.log`; Ctrl-C stops sclang and scsynth.
  `COS_OUT_DEVICE="MacBook Pro Speakers" ./run.sh` pins the output device. The runner and the
  Perform/Admin pages arrive with sub-project 3.
- `node scripts/engine-ping.ts` — prints roster, seats, state and `[COS]` status of a running engine.
- `npm run smoke` — boots a private engine on ports 57130/57131, drives it with fake sticks and
  checks the `[COS]` contract end to end (audible for ~10 s). Safe while a real engine runs.
- OSC contract: `airkit/code3.0/API.md`, the `[COS]` sections.
