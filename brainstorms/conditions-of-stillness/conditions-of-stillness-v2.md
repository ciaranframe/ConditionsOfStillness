# Conditions of Stillness — AirStick system — v2

## Quick Context
Session 1 continued into execution. Foundation (sub-project 1) and the engine profile (sub-project 2)
are built, reviewed, merged to `main` and pushed. The Perform/Admin page design is locked from a mockup.
Next: sub-project 3, the runner and pages.

## Session Log
| Date | Duration | Energy | Mode | Methods |
|---|---|---|---|---|
| 2026-09-26 (cont.) | long | build | connected | writing-plans; subagent-driven development with per-task and final reviews; design mockup + feedback round |

## Decisions Made
- Page design locked (cockpit, colour = status, "SCENE D" dominant, real stick names): mockup https://claude.ai/artifact/DdTVyHA4x2BFFuGCGrxYT1
- Meters read post-level (what the room hears); limiter lookahead 3 ms; `ready` = init completed for the currently installed env.
- Both repos on GitHub under ciaranframe: `ConditionsOfStillness` (piece) and `AirKit-conditions` (private mirror of branch `AirConditions`).

## Current Thinking
- The engine is stateless beyond §5; the runner owns scene state and must obey spec §5.1 (loaded ≠ ready; devices only after IMU; re-push everything on engine restart; params/partner persist per slot; steady-state CPU is eight live patches).
- `npm run smoke` (38 checks, fake sticks, private ports) is the engine's acceptance gate; keep extending it as the contract grows.

## Open Questions
- Footswitch choice; performance laptop; `patching/context/` material; wrist takes.
- Whether the levels broadcast needs an explicit subscribe once Admin and the audition tool both talk to the engine.

## Next Steps
1. Sub-project 3: plan the runner from spec §5.1 + §6 and the locked design; build against the fake AirKit, then the real engine.
2. Sub-project 4: patch skill and tooling (corpus mining first).
3. Ciaran: footswitch, context notes, takes.

## Overnight test
Same as v1: what does stillness sound like from a wrist holding a chord down, versus resting on the knee?
