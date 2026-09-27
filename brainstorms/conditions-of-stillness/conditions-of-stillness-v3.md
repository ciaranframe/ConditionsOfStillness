# Conditions of Stillness — AirStick system — v3

## Quick Context
Sub-project 3 (the Node runner and the Perform/Admin pages) planned, built with subagent-driven
development, reviewed and merged on 2026-09-27 while Ciaran was away. Next: sub-project 4
(the `airkit-patch` skill and tooling), run the same way without check-ins.

## Session Log
| Date | Duration | Energy | Mode | Methods |
|---|---|---|---|---|
| 2026-09-27 | long | build | connected | writing-plans; subagent-driven development (12 tasks, per-task reviews, one final review + one fix wave + one targeted round); headless-Chrome and real-engine verification |

## Decisions Made (rulings with Ciaran before the build)
- Same patch with different params/level in consecutive scenes = live change, no reload.
- The runner boots to STANDBY; a persisted state younger than 15 min (heartbeat-refreshed) is restored.
- Sticks are identified by OSC id in `scenes/cast.yaml`; Admin lists heard sticks and assigns them.
- A cue whose incoming sound is not ready waits up to 2 s, then fades anyway with a warning.

## Rulings made on Ciaran's behalf during the build
- Only RESUME clears a panic; every cue source is refused while panicked. `panicked` and each wrist's live slot are persisted.
- A runner restart over a healthy engine re-pushes levels/positions/params but skips loads whose seat already matches (spec §6 "re-push if different").
- Reconcile runs only while the engine is online; seats/status are cleared when it goes offline.
- A cast.yaml that cannot be read or parsed (including an empty file) keeps the previous cast.
- `dev:fake` works on a temp copy of cast.yaml; assignment from Admin writes cast.yaml atomically and clears the id from any other wrist.
- Ack correlation key is `ackId`; trim/master commands are not logged per message; commands are dispatched immediately.
- Pages: STICKS HEARD in Admin's left column; fader labelled TRIM; Space ignored on a focused button; the limiter row reads on/off.
- Node 26 strip-only TypeScript: no parameter properties/enums anywhere.

## Current Thinking
- The runner is rehearsal-ready against the fake and the real engine; the unknowns are the real sticks, the footswitch, the iPad on the venue network, and how `finishFadeNow`'s cut sounds.
- `docs/rehearsal-checklist.md` now has recovery drills.

## Open Questions
- Footswitch choice (Admin's PEDAL panel shows the last MIDI event to fill `cast.yaml`); performance laptop; `patching/context/`; wrist takes.

## Next Steps
1. Sub-project 4: plan `docs/superpowers/plans/2026-09-27-patch-skill.md`, build, review, merge.
2. First rehearsal per the checklist.
