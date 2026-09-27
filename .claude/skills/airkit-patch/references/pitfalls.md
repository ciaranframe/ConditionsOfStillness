# Pitfalls

Companion to `engine.md`. The union of Glimmer's `pitfalls.md` (1–23; 1–18 are COTF's
`bible/pitfalls.md`, kept in the same order so numbers match both), the lessons of COTF's five
annotated show patches, Steph's `concert_p_files.md` §12 (24–27), and what this engine adds
(28–40, from spec §5.1 and the engine itself). Each: symptom, cause, fix, and the lint rule
that catches it (`patching/tools/src/lint.ts`), if any. Where an older source disagrees with
this engine, the entry says so and follows the engine.

---

## 1. `loop.synth` returns the method, not your value
- **Symptom:** wrong data, no error. **Cause:** an Event resolves `.key` through `Object`'s
  methods first — `synth`, `play`, `stop`, `next`, `value`, `free`, `size`, `rate`, `dur`, `set`.
- **Fix:** index with `loop[\synth]` whenever a key could be a method name. `m.accelMass` is safe
  only because no method has that name. *Lint:* none.

## 2. `includes` is always false for a new String
- **Symptom:** a membership test silently fails. **Cause:** `Array.includes` is identity-based.
- **Fix:** `includesEqual` for Strings; or compare Symbols. *Lint:* none. (COTF `config.scd` scar.)

## 3. Room globals are nil inside a hook
- **Symptom:** `nil * nil`, a pattern on the wrong clock. **Cause:** hooks run inside
  `d.env.use`; a bare `~beatClock` / `~roomState` resolves against the patch env.
- **Fix:** `topEnvironment.use { … }`, or read `topEnvironment[\roomState]`. *Lint:* none.

## 4. `~outBus` is nil inside `topEnvironment.use`
- **Symptom:** audio to bus 0 or an error in `~init`. **Cause:** the mirror of 3 — `~outBus`
  lives in the patch env. **Fix:** `var ob = ~outBus ? 0;` at file top; pass `\out, ob`; never
  assign it. *Lint:* `banned.outbus-rewire`.

## 5. `~deinit` is asynchronous and may overlap the next `~init`
- **Symptom:** clicks, stuck voices, "Buffer has been freed", an orphan Pdef firing at freed
  buffers. **Cause:** `loadPersonality` runs `~deinit` in an un-awaited Routine.
- **Fix:** gate, never `.free`; capture refs and nil vars synchronously; stop pattern →
  `s.bind { g.freeAll }` → `s.sync` → `g.free` → buffers last, after the release tail; a
  `loading` flag that `~deinit` clears and `~init` checks after its `s.sync`. *Lint:* `style.compose`
  (partial). `patterns.md` §3, §12.

## 6. Literal `Pdef` keys and event-type names collide across slots
- **Symptom:** one slot's unload stops another's music; "my harp plays dulcimer samples".
- **Cause:** `Pdef` keys and `Event.eventTypes` are global. **Fix:** `Pdef(m.ptn)`,
  `(\cosNameEv_ ++ m.ptn).asSymbol`, and `Event.eventTypes.removeAt(name)` in `~deinit`.
  *Lint:* `pdef.literal-name` (warn). (Steph §12, §16.)

## 7. SynthDef names are global
- **Symptom:** another patch's sound changes when yours loads. **Cause:** last `.add` wins for
  the whole process; upstream `\simple` is defined twice. **Fix:** `\cos<Name><Part>`.
  *Lint:* `synthdef.prefix`, `synthdef.duplicate`, `synthdef.collision` (other patches + engine).

## 8. A tick before `~init`: `nil.set` kills the slot's tick loop
- **Symptom:** a slot freezes on its last values; `tickAgeMs` grows; log shows
  `Message 'set' not understood. RECEIVER: nil`. **Cause:** the tick loop starts before `~init`
  (which waits on `s.sync`). **Fix:** `if (synth.notNil) { … }` on every `.set`, in every hook,
  including `~onRoomState` and `~onSceneParams`. *Lint:* none; the audition's log scan catches it.

## 9. Blocking on the tick
- **Symptom:** jittery or stalled control for every slot. **Cause:** ticks run on the AppClock
  Routine. **Fix:** `s.sync`, `.wait`, `Buffer.read`, `SynthDef` only in `~init`/`~deinit`/a
  `fork`; a bare `s.bind { x.set(…) }` is fine. *Lint:* `tick.blocking`.

## 10. `~smooth` / `~slope` are nil at file-body time
- **Symptom:** `nil` call error on load. **Cause:** installed after `interpret`.
- **Fix:** call them only inside hooks. *Lint:* none.

## 11. A half-written file gets interpreted
- **Symptom:** a syntax error on save, or worse. **Cause:** hot reload polls `File.mtime` each
  tick. **Fix:** write a temp (not `.sc`) and rename; the tools do. *Lint:* none.

## 12. `~onRoomState` is an edge; a mid-state load misses it
- **Symptom:** a patch loaded during `\silent` can sound. **Cause:** no state tick runs in
  `\silent`, and the edge came before the load. **Fix:** seed from `topEnvironment[\roomState]`
  in `~init`; keep the body idempotent (the edge can repeat). *Lint:* `state.silent-unhandled`.

## 13. `~onResync` never fires here
- **Symptom:** none — which is the trap for a Pdef patch copied from COTF. **Cause:** no
  conductor and no resync dispatcher in this profile. **Fix:** install it only for portability;
  never make correctness depend on it. *Lint:* none. (COTF 13 says it is mandatory — there.)

## 14. Building a pattern outside `topEnvironment.use`
- **Symptom:** nil clock, wrong tempo. **Cause:** `~beatClock` is a top-level variable.
- **Fix:** build and play inside `topEnvironment.use`; keep `s.sync` outside it (a Routine
  restores its own env after a yield — Steph §27). *Lint:* none.

## 15. Clobbering `~init` / `~deinit`
- **Fix:** `~init = ~init <> { |d| … }`. *Lint:* `style.compose` (warn).

## 16. The trailing roster entry is unreachable
- **Cause:** `index.mod(size - 1)`. **Fix:** roster `["silence", …, "silence"]`, edited only with
  `patch-roster.ts`. *Lint:* `roster.missing` (warn).

## 17. Too loud
- **Symptom:** the ensemble disappears; the limiter pumps. **Cause:** no per-patch trim; the
  limiter is a safety net. **Fix:** peaks −12…−6 dBFS when shaken hard (profile level plan);
  soft ceiling (`.tanh`, `Limiter.ar`) on resonant or stacked designs. *Lint:* none; audition.

## 18. Server control from a patch
- **Symptom:** every slot, monitor and the master die; `run.sh` restarts. **Fix:** never
  `Cmd-.`, `s.freeAll`, `Server.killAll`, `CmdPeriod.run`; free only your own nodes.
  *Lint:* `banned.server-control`.

## 19. Gravity is in the accelerometer
- **Symptom:** sound when the wrist is merely tilted. **Cause:** `accelMass` ≈ 0.32 flat, up to
  ≈ 0.56 tilted, at rest. **Fix:** the template's gravity-free `energy`; or a rest floor ≥ 0.6 on
  raw `accelMassFiltered`. *Lint:* none.

## 20. There is no conductor
- **Symptom:** one note forever; beat hooks silent. **Cause:** `ctx.voicePool` is `[69]`, score
  features 0, beat hooks never dispatched. **Fix:** the patch carries its own pitch world and
  time. Never set `~scoreAnchorBeat` (Steph §12). *Lint:* none.

## 21. Plugins: allowed here, but verify the class and its arguments
- Glimmer 21 says no sc3-plugins; **this machine has them and the profile allows them**
  (`JPverb`, `Greyhole`, `MembraneCircle`, `DWGBowed`, `OteyPiano`, `MdaPiano`, `BMoog`, `DFM1`,
  `NHHall`, STK…). Still read the help file before use: wrong argument order doesn't error, it
  sounds wrong or explodes. *Lint:* `class.unknown` (also catches hallucinated UGens).

## 22. Things that blow up
- **Cause:** low-`rq` resonant filters swept by gesture, `Klank`/`Ringz` driven continuously,
  feedback near 1, `Formlet`, `Pluck` coef near ±1, an unclamped gesture value multiplied in.
- **Fix:** `.clip` every gesture-derived control, `LeakDC` after nonlinearities, an output
  ceiling. Sticks are near heads and a PA. *Lint:* none; audition peaks.

## 23. Per-event synths must free themselves, in your own Group
- **Symptom:** "exceeded number of available nodes". **Fix:** `doneAction: Done.freeSelf`,
  spawn into a Group made in `~init`, rate-limit spawns (refractory). *Lint:* none.

## 24. `.odd` on a Float
- **Symptom:** `Message 'odd' not understood` in an event. **Cause:** `~octave` defaults to
  `5.0`. **Fix:** `.asInteger` before `.odd`. *Lint:* none. (Steph §12.)

## 25. Long release × fast `\dur` = node pressure
- **Cause:** 1.4 s release at 0.2 s dur, several lines → hundreds of voices. **Fix:** release
  shorter than a few durs; cap polyphony. *Lint:* none. (Steph §12.)

## 26. Mixed latency reorders messages on the server
- **Cause:** `s.bind` bundles at `s.latency` (0.05 s here); `sendMsg` is immediate.
- **Fix:** keep related messages on the same timeline — `s.bind` around `freeAll` after a
  Pbind. *Lint:* none. (Steph §6, §12.)

## 27. `1 ! N` vs `[1] ! N`
- **Cause:** the second is N arrays; `.sum` then broadcasts to `[N]` and a later lookup throws.
- **Fix:** mind accidental array wrapping in pattern-length maths. *Lint:* none. (Steph §12.)

## 28. The corpus predates this engine
- **Symptom:** a copied idea never fires. **Cause:** older branches had `~onHit`, `~onMoving`,
  `~nextMidiOut`, `~vdef`, `\customVisualEvent`, `m.com` pitch passing; COTF patches lean on
  beat hooks and `~onResync`. None of these is dispatched here (`engine.md` §2).
- **Fix:** copy the *logic*, re-host it in `~idleNext`, cite where it came from. *Lint:*
  `class.unknown` catches some; the rest only the audition shows.

## 29. Handlers land before `~init`, or on the patch being replaced
- **Symptom:** `nil` errors in `~onSceneParams`; the outgoing patch jumps to the next scene's
  params for a moment. **Cause:** `~onSceneParams` exists from file-body time; the runner sends
  params before the load, to the env still installed (spec §5.1). **Fix:** hooks only set vars;
  every synth reference guarded. *Lint:* `hooks.scene-params` (presence only).

## 30. Caching the partner's model
- **Symptom:** a `2H` patch stops following the other hand after that slot reloads.
- **Cause:** the partner's env is replaced on every reload. **Fix:** read
  `~partner !? { |p| p.env[\model] }` every tick; smooth raw partner values yourself — the
  partner's `*Filtered` coefficients belong to its own patch (`silence` sets 0.7/0.2).
  *Lint:* `partner.guard`, `name.two-hand`.

## 31. Scene-param values: Symbols, absent, stale
- **Symptom:** `register` never matches; a patch breaks with no params. **Cause:** strings arrive
  as Symbols (`\low == "low"` is false); the map entry may be nil or empty. **Fix:** compare
  `.asSymbol`, clamp numbers, default every key, test with no params. *Lint:* `hooks.scene-params`.

## 32. State that explodes on first hearing
- **Symptom:** a crossfade arrives already dense, ringing or loud. **Cause:** the standby slot
  ran unheard on the performer's motion for minutes. **Fix:** leaky, clamped integrators; no
  queued events; no charged feedback (`patterns.md` §11). *Lint:* none; audition `--long`.

## 33. Idle CPU is eight live patches
- **Symptom:** dropouts when nothing is happening. **Cause:** every standby slot ticks and
  sounds at level 0. **Fix:** a rest floor that stops spawning; one long-lived synth per voice;
  measure sclang CPU as well as `serverCpu` (spec §5.1). *Lint:* none.

## 34. One-bar quant on this clock is four seconds
- **Cause:** `~beatClock` is `TempoClock.new(2)`; COTF's `quant: 8` waits up to 8 beats.
- **Fix:** a small quant (0–0.25) or none. *Lint:* none.

## 35. Sample paths not from `~cosSamples`
- **Symptom:** silence on another machine; "Buffer UGen: no buffer data"; a `GrainBuf` on an empty
  buffer can take scsynth down. **Fix:** `topEnvironment[\cosSamples] +/+ "COS_<Name>/wav/<slot>.wav"`,
  mono for grains, name short reads, build only after the barrier.
  *Lint:* `sample.manifest`, `banned.abs-path`.

## 36. Writing shared state
- **Symptom:** another wrist or the next scene changes. **Cause:** `topEnvironment[…] =`,
  `~cos… =`, `~devices`, or `m.com.x =` are shared by all nine slots. **Fix:** lexical vars only.
  *Lint:* `banned.global-write` (not `m.com`).

## 37. Rotation rate and angles have edges
- **Symptom:** spikes near vertical; a sweep through the middle when turning past ±180°.
- **Cause:** `rrateEvent` is per packet and Euler angles gimbal-lock at pitch ±π/2; smoothing
  an angle across its ±1 wrap. **Fix:** clamp rates; unwrap or use rates for yaw and roll.
  Calibration and `quatCalibrated`/`sensorBus` are unreliable — don't use them. *Lint:* none.

## 38. Indexing past an array in a tick
- **Symptom:** the slot freezes (8) on one gesture extreme. **Cause:** `linlin(-1, 1, 0, a.size)`
  reaches `a.size` (BASSBUZZ, JUPITERSHARP). **Fix:** `clipAt`/`wrapAt`, or an explicit clip.
  *Lint:* none.

## 39. Posting every tick; stale headers; audition modes left on
- **Fix:** post on change only (*lint* `tick.posting`); rewrite the header last so it matches the
  finished patch (*lint* `header.keys`); ship any preview mode OFF (PERCUSSION `previewMode`).

## 40. `\silent` must mute every engine, and one-shots too
- **Cause:** there is no tick in `\silent` to catch the voice you forgot; one-shots bypass a
  Pdef's `\amp` (Steph §20). **Fix:** mute each synth and block spawns in the `\silent` branch;
  a positive `.dbamp` floor is a boost, not silence (SOPRANOVOICE). *Lint:* `state.silent-unhandled`.
