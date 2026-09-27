# Conditions of Stillness — piece profile

What `/airkit-patch` and its tools need to know about this piece, so the skill itself can stay
generic. Read alongside `patching/context/` (the piece's own programme note and scene notes,
which shape *what* a patch should sound like — this file is about the *contract* a patch has to
meet to run in the room).

## Piece and instruments

Zubin (piano) and Claire (bass drum) each wear one AirStick on each wrist — four sticks in all:
`ZL`, `ZR`, `CL`, `CR`. A stick streams its wrist's motion (accelerometer + gyroscope) at ~33 Hz;
a patch reads it as `~model`, not as "the piano" or "the drum" — the gesture is all it gets.

What playing looks like to the IMU: over the keys, ordinary playing is small, fairly fast
vertical accelerations; a rolled or voiced chord turns the wrist as it's played; a tremolo shows
up as a sustained high-frequency shake, low in amplitude but rapid. On the bass drum, a stroke is
a sharp acceleration spike with a rebound (the beater in and back); damping — the hand laid on
the head to stop the ring — reads as a hand gone still, near-zero motion, right after a stroke.

Either wrist can be the *non-playing* hand at any moment — resting, turning a page, gesturing
expressively — and a patch must treat low motion there as ordinary, not as a fault. Stillness is
not a gap to fade through: it's a musical state the piece is named for, and every patch needs
something real to do when motion is near zero, not just silence.

## Naming

Patch files and personality names: `COS_<UpperCamel>` (e.g. `COS_Glass`). Two-hand patches
(below) end in `2H` (e.g. `COS_Membrane2H`). SynthDef names inside a patch are global across the
whole AirKit process, so prefix them `cos<Name>…` (e.g. `\cosGlassVoice`) — an unprefixed name
can collide with another patch's.

## Roster path

`airkit/lists/list_conditions.sc`, shaped `["silence", …, "silence"]`: index 0 is what a freshly
connected device gets, and the last entry is an unreachable sentinel. Edit it only through
`patch-roster.ts` (atomic write) — never by hand while a rehearsal is running.

## Template

`airkit/personalities/COS_Template.sc` is the runnable skeleton: a plain two-sine voice whose
loudness follows wrist motion and whose pitch follows tilt. Copy it rather than starting from a
blank file — its comments carry the load-bearing idioms (compose `~init`, release by `gate` not
`.free`, guard `synth.notNil` in the tick, read params at both `~init` and `~onSceneParams`) that
every patch here depends on.

## Scene-parameter contract and recommended keys

`~sceneParams` is read once in `~init` from `topEnvironment[\cosSlotParams][d.index]`; a scene
change can retarget a slot's parameters at any time, before or after the patch itself loads, so
`~onSceneParams = { |p| }` must handle the update arriving later too. Recommended keys (a patch
uses whichever subset makes sense for it; any scalar not in this list still passes through):

- `register` — `low` | `mid` | `high`
- `density` — 0–1
- `brightness` — 0–1
- `pitchset` — a name the patch itself understands (a scale, a mode, a pitch collection)
- `rate` — Hz
- `wet` — 0–1 (reverb/effect mix)

## Two-hand contract

`~partner` is nil for an ordinary one-hand sound. A `2H` patch loads on the performer's
left-wrist slot with `~partner` set to the right wrist's device, and the right wrist's own slot
is silenced — don't add an independent right-wrist layer. Re-read `~partner.env[\model]` on
every tick rather than caching it: the partner device's env is replaced whenever that slot
reloads, so a cached reference goes stale silently.

## Level plan

Stereo PA, one pair of speakers for the room. Peaks land roughly −12…−6 dBFS when a wrist is
shaken hard, quieter most of the time. This is chamber music with electronics, not the other way
round: the ensemble must still be heard through the patch at every dynamic. The master limiter is
a safety net for something going wrong, not a mixing tool — a patch that relies on being caught
by it is already too loud.

## Plugins

sc3-plugins 3.14 is installed (`~/Library/Application Support/SuperCollider/Extensions`) and
allowed. `patch-lint.ts` checks every UGen class a patch uses against `SCClassLibrary` and that
Extensions folder — an unrecognised class fails lint before the file ever reaches sclang.

## Audition

Slot 9 is reserved for auditioning and never used by a scene. `npm run patch:audition -- <Name>`
loads a patch there through a private device and drives it with synthetic gesture phases or a
recorded take, so a patch can be heard without touching a performer's wrist mid-rehearsal.

## Takes

A take is a recorded, replayable IMU stream from one wrist: `takes/<label>.take.jsonl`
(gitignored; one JSON line per packet, timestamped). `takes/INDEX.md` lists what exists — check
there before recording a near-duplicate.

## Samples

A patch that needs sample audio declares `samples:` in its header. Files live in
`samples/COS_<Name>/`: the skill writes `SHOPPING.md` (what to look for, per slot); Ciaran
downloads into the folder under any filenames; `npm run samples:check -- <Name>` matches,
converts to 48 kHz WAV and writes `manifest.json` plus a `SOURCES.md` skeleton. The patch loads
samples only through `topEnvironment[\cosSamples]` (or `~cosSamples`) and the slot name from the
manifest — never a literal path.

## Hand-off format

When research hands off to writing a patch, describe gestures in piano and drum terms a player
would recognise — a rolled chord, a tremolo, a soft mallet stroke, a hand damping the head — not
in IMU-signal terms. Say what should be audible at rest versus when shaken, so auditioning has
something concrete to listen for. Name which scene-parameter keys are worth trying and what each
is expected to do.

## Where context lives

`patching/context/` holds whatever Ciaran has put there about the piece — programme note,
scene-by-scene notes, anything else relevant. `/airkit-patch` reads every file in it in full
before researching any sound; it shapes the research more than the brief does, so keep it
current.

## Research note location

One note per patch, written before the patch itself: `patching/notes/COS_<Name>.md`, following
the template at `.claude/skills/airkit-patch/assets/note-template.md`.
