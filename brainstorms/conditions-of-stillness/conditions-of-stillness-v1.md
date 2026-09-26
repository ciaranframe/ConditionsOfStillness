# Conditions of Stillness — AirStick system — v1

## Quick Context
A composed piece for two AirStick-wearing performers (Zubin, piano; Claire, bass drum; one stick
per wrist) and a chamber ensemble (flute, clarinet/bass clarinet, violin, cello). Scenes assign a
sound per wrist and crossfade on a footswitch cue. Session 1 designed the whole system as four
sub-projects and produced the umbrella spec
`docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md`.

## Session Log
| Date | Duration | Energy | Mode | Methods |
|---|---|---|---|---|
| 2026-09-26 | one long session | deep exploration | connected (COTF, Glimmer, AirKit) | context survey; structured questioning (5 rounds); 2–3 approaches per axis; sectioned design |

## Open Questions
- Which two-switch MIDI footswitch? (USB vs Bluetooth MIDI; page-turner pedals send keystrokes, not MIDI.)
- Is this laptop the performance machine? (SC 3.13.0, no sc3-plugins installed yet.)
- Does Zubin want a dedicated small display at the piano?
- What scene-parameter vocabulary will the first patches want?
- What is the musical material per scene? Ciaran will supply `patching/context/` before patching.

## Current Thinking
- The sticks capture *playing* (piano hands, drum strokes) as well as free gesture. Patches must
  distinguish and use both; the non-playing hand is a resource; rest is a musical state.
- Crossfades of up to 10 s with both sounds live means two slots per wrist and a per-wrist
  equal-power crossfader; preloading the next scene makes the pedal instant.
- Node owns the show state; SuperCollider is a stateless engine. A runner restart or an AirKit
  restart both reconcile.
- The patch skill's depth comes from six research tracks (adds SuperCollider practice and mining
  Steph's 200+ personalities across branches) and from auditioning against recorded real takes.
- Steph's real corpus is on other branches (`Airsticks-RPI` 233, `Airsticks-Desktop` 187,
  `MiMBrentonShows` 130); `AirConcert` has only 32.

## Ideas Inventory
**Ready**
- Four sub-projects in order: foundation, engine profile, runner + pages, skill + tooling.
- Vocabulary: performer, wrist (ZL ZR CL CR), sound, two-hand sound (`2H`), scene, cue, transition
  (outgoing/incoming), slot (hidden), take.
- Slot 9 as an audition slot.
- Shopping-list samples workflow with manifest by slot name.

**Developing**
- Corpus digest of recurring logics (energy tiers, stillness reveals, direction detection) as the
  skill's first read.
- `tickAgeMs` per slot in status so a dead tick loop is visible on Admin.

**Raw**
- Scene ids lettered to mirror PatchMarks letters (by convention only).
- Admin "audition on a wrist" mirroring that wrist's IMU to slot 9.

**Parked**
- Score ↔ scenes link (Ciaran chose scenes file only).
- Two AirKit instances (rejected for two-hand sounds).
- Spatialisation beyond stereo.

**Eliminated**
- Crossfade inside the patch contract: one device holds one live patch, so "both live" is impossible.
- Runner logic split between Node and SC: two sources of truth.

## Decisions Made
See the spec §11 (decisions log) — thirteen decisions with reasoning, all made 2026-09-26.

## Next Steps
1. Foundation: git init here (done at session end), `AirConditions` worktree, private mirror
   `ciaranframe/AirKit-conditions`, `setup.sh`, `run.sh`.
2. Engine profile plan + build.
3. Runner plan + build.
4. Skill + tooling plan + build (corpus mining first, so the skill has something to read).
5. **Ciaran: record wrist takes** once the runner and `take-record.ts` exist (piano scales, chords,
   tremolo, octaves; bass drum strokes, rolls, damping; stillness; both wrists).
6. Ciaran: choose the footswitch; write `patching/context/` (programme note, per-scene notes).

## Overnight test
What does *stillness* sound like from a wrist that is holding a piano chord down, and how is it
different from a wrist resting on the knee? The first patch will have to answer that.
