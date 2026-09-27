# Patterns — the authoring idioms

Companion to `engine.md`. Each idiom is a *shape* with a short sketch, the corpus files that
use it (Steph's mined personalities, `patching/corpus/<branch>/personalities/…`, gitignored raw
copies in the main checkout — cited `` `token` (path:line) `` as in `engine.md`), and the recipe
in Steph's `~/AirKit/code3.0/concert_p_files.md` (cited "Steph §n"). Copy the shape, not the
sound. The corpus predates this engine: its pitch comes from `ctx.voicePool` or `m.com`, its
rhythm from beat hooks or `~onHit`, none of which exists here (`pitfalls.md` §28). Substitute
the patch's own pitch world and gesture-driven time.

Every sketch assumes the template's file-top preamble:

```supercollider
var m  = ~model;
var ob = ~outBus ? 0;        // capture now; nil inside topEnvironment.use
```

---

## 1. Long-lived synth + `.set` — start here

One gated Synth for the whole load, reshaped every tick; smoothing lives in the SynthDef
(`.lag`, `.lagud`) so the tick sends targets, not trajectories. The template is this shape.

```supercollider
var synth;
SynthDef(\cosNameVoice, { |out = 0, amp = 0, freq = 220, cutoff = 1200, gate = 1|
    var env = EnvGen.kr(Env.asr(0.05, 1, 0.15), gate, doneAction: Done.freeSelf);
    var sig = RLPF.ar(Saw.ar(freq.lag(0.1) * [1, 1.003]), cutoff.lag(0.2).clip(40, 12000), 0.4);
    Out.ar(out, (sig * amp.lagud(0.03, 0.9)).tanh * env * 0.3);
}).add;
~init = ~init <> { |d| topEnvironment.use { synth = Synth(\cosNameVoice, [\out, ob]) }; d };
~deinit = ~deinit <> { var sy = synth; synth = nil; if (sy.notNil) { sy.set(\gate, 0) } };
~idleNext = { |d, ctx|
    var e = track.();                    // the template's gravity-free energy
    if (synth.notNil) { synth.set(\amp, e.lincurve(0.03, 1.5, -42, -9, -3).dbamp) };
};
```

- Corpus: `synth.set(\gate, 0);` (patching/corpus/AirConcert/personalities/BASSBUZZ.sc:71) (release by gate), the house
  gesture→dB curve `(m.accelMass + m.rrateMass).lincurve(0, 1.0, -80, -10, 4)` (patching/corpus/AirConcert/personalities/BASSBUZZ.sc:80)
  (−80 dB floor keeps a still wrist silent), three held voices in one Group in
  `voices = 3.collect` (patching/corpus/AirConcert/personalities/cotf_whisperer1.sc:76). Steph §2A, §25.
- Release ≤ 0.2 s (the template's `Env.asr(0.05, 1, 0.15)`), or `~deinit` is not silent in
  ~200 ms. whisperer's `rel=2.0` release and `2.5.wait` are too slow for this engine.

## 2. `Pdef` on a clock, no conductor

No beat hooks fire and `~onResync` never runs here (`engine.md` §2), so a pattern is a
free-running clock with gesture-set parameters. Key it `m.ptn`, give its synths a Group, set
parameters with `Pdef(m.ptn).set` from the tick (a class message: no nil-throw risk).

```supercollider
var group;
~init = ~init <> { |d|
    topEnvironment.use {
        group = Group.new;
        Pdef(m.ptn, Pbind(\instrument, \cosNameHit, \out, ob, \group, group));
        Pdef(m.ptn).set(\amp, 0, \dur, 0.25);        // seed the .set-driven keys here
        Pdef(m.ptn).play(~beatClock, quant: 0.25);   // not 8: that is 4 s on this clock
    };
    d
};
~deinit = ~deinit <> {
    var g = group; group = nil;
    Pdef(m.ptn).remove;
    if (g.notNil) { fork { s.bind { g.freeAll }; s.sync; g.free } };
};
~idleNext = { |d, ctx|
    var e = track.();                    // the template's gravity-free energy
    Pdef(m.ptn).set(\amp, e.lincurve(0.05, 2, -40, -12, -2).dbamp,
        \dur, m.rrateMassFiltered.clip(0, 1).linexp(0, 1, 0.5, 0.0625));
};
```

A Pdef's `envir` is chained *under* its pattern (`pattern <> envir`, SCClassLibrary
`JITLib/Patterns/Pdef.sc`), so a key the `Pbind` sets itself always wins: any key driven by
`Pdef(...).set` must not be hard-coded in the `Pbind` (or read it with `Pkey`), or the tick's
`.set` changes nothing and the pattern stays silent.

- Corpus: the pre-COTF branches ran exactly this, without a conductor —
  `Pdef(m.ptn).play(quant: 0.1);` (patching/corpus/Airsticks-RPI/personalities/_TEMPLATE_ak_pfile.sc:88), torn down by
  `Pdef(m.ptn).remove;` (patching/corpus/Airsticks-RPI/personalities/_TEMPLATE_ak_pfile.sc:93) and
  `s.bind { group.freeAll };` (patching/corpus/Airsticks-RPI/personalities/_TEMPLATE_ak_pfile.sc:96). Steph §2B, §5, §19
  (rotation → subdivision, `linexp`).
- `s.bind` on `freeAll`: Pbind sends `/s_new` at `s.latency`; an unbundled `/g_freeAll` lands
  first and a late synth sticks at sustain (Steph §6).
- A Pdef running while unheard spawns synths all the time: keep `\amp` at 0 *and* make the
  event rest (`\type, \rest`) below the rest floor, or it costs CPU for nothing (§11).

## 3. Sample map + load guard through `~cosSamples`

Samples live in `samples/COS_<Name>/wav/<slot>.wav` (see `samples.md`); the path is built from
`topEnvironment[\cosSamples]` and nothing else (lint `sample.manifest`, `banned.abs-path`).

```supercollider
var bufs, loading = false;
var slots = [\drop, \rim];                       // the header's samples: keys
~init = ~init <> { |d|
    var dir = topEnvironment[\cosSamples] +/+ "COS_Name" +/+ "wav";
    loading = true;
    bufs = slots.collect { |k| Buffer.readChannel(s, dir +/+ (k ++ ".wav"), channels: [0]) };
    s.sync;                                      // legal: ~init is a Routine
    if (loading.not) { "[COS_Name] load cancelled".postln } {
        bufs.do { |b, i| if (b.numFrames.isNil or: { b.numFrames == 0 }) {
            "[COS_Name] missing sample %".format(slots[i]).postln } };
        // build synths / Pdef here, after the barrier
    };
    d
};
~deinit = ~deinit <> {
    var b = bufs; bufs = nil; loading = false;
    // release voices first, then free buffers after the release tail
    fork { 0.3.wait; b.do { |x| x.free } };
};
```

- Corpus: `loading = true;` (patching/corpus/AirConcert/personalities/JUPITERSHARP.sc:89), the barrier `s.sync;` (patching/corpus/AirConcert/personalities/JUPITERSHARP.sc:100),
  the bail `if(loading.not or: { samplesLib.isNil },{` (patching/corpus/AirConcert/personalities/JUPITERSHARP.sc:103), and naming short
  reads `numFrames.isNil` (patching/corpus/AirConcert/personalities/JUPITERSHARP.sc:109); `~deinit` clears it,
  `loading = false;` (patching/corpus/AirConcert/personalities/JUPITERSHARP.sc:165). Steph §27 (why a per-file counter is
  wrong; keep `s.sync` outside `topEnvironment.use`).
- Read by slot name, not by folder index: `pathMatch` sorts case-insensitively and an added
  file renumbers the rest (COTF pitfall, `PERCUSSION` index map).
- `manifest.json` (`slot → file, frames, channels, sr`) can be read in `~init` with
  `String:parseJSONFile` (keys are Strings) when a patch needs frames or channels.

## 4. Granular pad

A long-lived grain voice on one mono buffer; gesture sets density, position, pitch ratio.

```supercollider
SynthDef(\cosNamePad, { |out = 0, buf = 0, amp = 0, rate = 1, dens = 20, pos = 0.5, gate = 1|
    var env = EnvGen.kr(Env.asr(0.1, 1, 0.2), gate, doneAction: Done.freeSelf);
    var trig = Impulse.kr(dens.lag(0.3).clip(2, 60));
    var sig = GrainBuf.ar(2, trig, 0.12, buf, rate.lag(0.5),
        (pos.lag(0.4) + WhiteNoise.kr(0.02)).wrap(0, 1), 2, TRand.kr(-0.6, 0.6, trig));
    Out.ar(out, sig * env * amp.lagud(0.1, 0.8));
}).add;
```

- Corpus: `GrainBuf.ar(2, trig, grainDur, bufnum, rate, pos, 2, 0)` (patching/corpus/AirConcert/personalities/SOPRANOVOICE.sc:59), its mono read
  `Buffer.readChannel(s, samplePath.standardizePath, channels: [0]` (patching/corpus/AirConcert/personalities/SOPRANOVOICE.sc:82), the pad built only
  once the buffer exists, `if (sampleBuffer.notNil) {` (patching/corpus/AirConcert/personalities/SOPRANOVOICE.sc:87); the same pad under a
  noise-wind engine in `GrainBuf.ar(2, trig, grainDur` (patching/corpus/AirConcert/personalities/WindVoice.sc:59); `Warp1.ar` time-stretch
  clouds on the older branches, `Warp1.ar(1, buffer` (patching/corpus/Airsticks-RPI/personalities/mel2.sc:17). Steph §16
  (per-state grain envelope: expose attack and decay, not one `grainDur`).
- `GrainBuf`/`TGrains` need a **mono** buffer; their `rate` is a pitch ratio (no
  `BufRateScale`), `PlayBuf`'s is not. Write the sample's own pitch down (`srcFreq`).

## 5. Hit detection — threshold + refractory + hysteresis

There is no `~onHit` here. Detect in the tick, and at ~33 Hz a bare threshold fires every tick
while a value sits above it.

```supercollider
var lastHit = 0, armed = true;           // plus `group`, made in ~init (§2)
~idleNext = { |d, ctx|
    var e = track.();                               // gravity-free energy (template)
    var now = thisThread.seconds;
    if (armed and: { e > 0.9 } and: { (now - lastHit) > 0.12 }) {   // strike: rise + refractory
        lastHit = now; armed = false;
        if (group.notNil) { s.bind { Synth(\cosNameHit, [\out, ob, \amp, e.linlin(0.9, 3, 0.1, 0.4)], group) } };
    };
    if (e < 0.5) { armed = true };                  // re-arm below a lower threshold
};
```

- Corpus: the refractory window `if(TempoClock.beats > (lastTime + 0.2),{` (patching/corpus/AirConcert/personalities/BASSBUZZ.sc:91); the
  rest floor `var restFloor = 0.2;` (patching/corpus/AirConcert/personalities/PERCUSSION.sc:68) and the hysteretic tier machine
  `var tier = switch(currentTier,` (patching/corpus/AirConcert/personalities/PERCUSSION.sc:550). Steph §24 `strike`.
- Quote a threshold with its input mapping: PERCUSSION's 0.60/1.10 rise, 0.45/0.85 fall mean
  `accelMassFiltered.linlin(0, 3.0, 0, 1.5)` and nothing else.
- A drum stroke is spike + rebound: the rebound is a second peak within ~50–100 ms (inferred
  from the profile's description) — the refractory must outlast it or one stroke fires twice.
  Calibrate on a take.
- Per-event synths free themselves (`doneAction: Done.freeSelf`) into the patch's own Group.

## 6. Energy tiers

An integral of recent motion, compared against rising and falling thresholds, gives three
behaviours from one state.

```supercollider
var energy = 0, tier = \low, lastTier = \low;
// in the tick:
energy = (energy * 0.98 + (e * 0.03)).min(4);        // leaky, and CLAMPED (see §11)
tier = case
    { tier == \high and: { energy < 1.5 } } { \med }
    { tier == \med  and: { energy < 0.3 } } { \low }
    { tier == \low  and: { energy > 0.5 } } { \med }
    { tier == \med  and: { energy > 2.0 } } { \high }
    { true } { tier };
if (tier != lastTier) { lastTier = tier; /* tier-entry change, posted once */ };
```

- Corpus: per-load engagement integral `engagement = engagement + (activity * tickDt);` (patching/corpus/AirConcert/personalities/PERCUSSION.sc:560)
  driving fill density `var fillEvery = engagement.linlin(0, 300, 8, 2)` (patching/corpus/AirConcert/personalities/PERCUSSION.sc:557); an
  inverted tier (stillness = full chord) in `{ activity > 0.99 } { \high }` (patching/corpus/AirConcert/personalities/cotf_whisperer1.sc:139).
  Steph §23 (decay 0.98 per tick at 30 Hz: a time constant of ≈ 1.6 s, half-life ≈ 1.1 s;
  hysteresis; tier-entry effects; time-in-tier).
- `tickDt = 0.033` hard-coded mirrors `~secs`; derive time from `thisThread.seconds` instead.

## 7. Stillness reveal

This piece is named for stillness: near-zero motion must *do* something, not just fade. A
reveal that only stillness unlocks is the most on-brief depth mechanic.

```supercollider
var lastMotion = 0, stillFired = false;
// in the tick:
if (e > 0.05) { lastMotion = thisThread.seconds; stillFired = false };
if (stillFired.not and: { (thisThread.seconds - lastMotion) > 6 }) {
    stillFired = true;              // one-shot: a bloom, a held partial, a ghost of the last gesture
};
```

- Corpus: whisperer keeps the clock, `lastMotion = now;` (patching/corpus/AirConcert/personalities/cotf_whisperer1.sc:148), and its header
  promises a ghost echo after >10 s of stillness; the fire itself is not in that file (its own
  TODO asks whether the ghost works). Recipe: Steph §24 `stillness`, §26 "Stillness trigger" (at
  most two reveals per patch, each a distinct interaction shape).
- The non-playing hand is often still for long stretches; decide whether stillness there is a
  reveal or a resting bed, and say so in the note. Damping (still right after a stroke) is a
  distinct, short stillness — the gap between them is the design choice.

## 8. Direction and reversal

```supercollider
var prevY = 0, dir = \still, lastDirAt = 0;
// in the tick:
var dy = m.gyroYFiltered - prevY;
var nd = case { dy > 0.02 } { \up } { dy < -0.02 } { \down } { true } { \still };
prevY = m.gyroYFiltered;
if (nd != dir and: { nd != \still }) {
    var reversal = (dir != \still) and: { (thisThread.seconds - lastDirAt) < 0.5 };
    // reversal -> chord / accent; otherwise a gesture in direction nd
    dir = nd; lastDirAt = thisThread.seconds;
};
if (nd == \still) { dir = \still };
```

- Corpus: `var dy = m.gyroYFiltered - prevY;` (patching/corpus/AirConcert/personalities/cotf_cascade1.sc:161), edge detection
  `if (newDir != dir and: { newDir != \still }` (patching/corpus/AirConcert/personalities/cotf_cascade1.sc:174), reversal within 0.5 s
  `var isReversal = (dir != \still)` (patching/corpus/AirConcert/personalities/cotf_cascade1.sc:175) firing a chord,
  `fireChord.(root, tier, ampScale);` (patching/corpus/AirConcert/personalities/cotf_cascade1.sc:186). Steph §24 `direction`, `hold`,
  `reversal`; `personality_authoring.md` §8.
- Rotation isolated from impact, two handles from one wrist:
  `var under = m.accelMassFiltered.lincurve(0, 1.0, m.rrateMassFiltered.neg, 0, -1).neg.lincurve(0, 0.4, 0, 1, -1` (patching/corpus/AirConcert/personalities/cotf_test2.sc:132)
  — the inner `lincurve` maps impact onto −rotation…0, the `.neg` turns it into rotation that
  impact pulls towards 0, and the outer `lincurve` stretches 0–0.4 onto 0–1: high for a
  smooth turn, ~0 for a strike (Steph §9). Useful for a pianist's rolled chord vs a key attack.

## 9. Two-hand (`2H`): partner energy, mirror, complement

A `2H` patch runs on the left wrist's slot and reads the right wrist through `~partner`
(`engine.md` §5.2). Re-read every tick, guard, smooth raw values yourself.

```supercollider
var pE = 0;                                          // partner energy, smoothed here
~idleNext = { |d, ctx|
    var e = track.();
    var pm = ~partner !? { |p| p.env[\model] };      // guarded; never cached
    var pa = pm !? { |x| x[\accelMass] } ? 0.35;
    pE = pE + (((pa - 0.35).abs * 2 - pE) * 0.2);    // rough gravity-free, one-pole
    if (synth.notNil) { synth.set(
        \amp, (e + pE).lincurve(0.03, 3, -42, -9, -3).dbamp,   // sum: either hand plays it
        \pan, (e - pE).clip(-1, 1) * 0.6,                       // complement: balance places it
        \cutoff, (pm !? { |x| x[\gyroYFiltered] } ? 0).linexp(-1, 1, 300, 6000)) };  // mirror
};
```

- Three shapes: **sum/partner energy** (either hand excites the sound), **mirror** (the same
  control from both wrists, e.g. tilt), **complement** (difference or division of labour: one
  hand excites, the other shapes — the pianist's left sustains while the right colours).
- Prior art in the corpus is only `m.com`, a single Event shared by every device, used to pass
  pitch between sticks: `m.com.root = e.root;` (patching/corpus/Airsticks-RPI/personalities/_TEMPLATE_ak_pfile.sc:106). Here it
  would leak across all nine slots and scenes; `~partner` is the contract.
- Name it `COS_<Name>2H` only if it reads `~partner.env`/`.sensors` (lint `name.two-hand`).

## 10. Scene-parameter mapping

Params are data from the scene file, arriving at `~init` or later (`engine.md` §5.1). Map them
into lexical vars in one place, with defaults for absent keys; the tick reads the vars.

```supercollider
var register = \mid, density = 0.5, bright = 0.5;
var applyParams = { |p| p !? {
    p[\register] !? { |r| register = r.asSymbol };            // Symbol from OSC
    p[\density] !? { |v| density = v.asFloat.clip(0, 1) };
    p[\brightness] !? { |v| bright = v.asFloat.clip(0, 1) };
} };
~init = ~init <> { |d| applyParams.(topEnvironment[\cosSlotParams] !? { |mp| mp.at(d.index) }); d };
~onSceneParams = { |p| applyParams.(p) };                     // may run before ~init: vars only
```

- Template: `applyParams.(topEnvironment[\cosSlotParams]` (airkit/personalities/COS_Template.sc:58) and `~onSceneParams = { |p| applyParams.(p) };` (airkit/personalities/COS_Template.sc:69).
- Keys (profile): `register` low|mid|high → octave or partial set; `density` 0–1 → event rate or
  grain density; `brightness` 0–1 → cutoff / partial tilt; `pitchset` → a named collection the
  patch defines; `rate` Hz → an LFO or pulse; `wet` 0–1 → effect mix. Declare the used ones in
  the header `params:` with defaults (lint `hooks.scene-params` checks each is read).
- A param should change *character*, not replace the gesture mapping; clamp everything.

## 11. Crossfade-aware exit — cheap when unheard

A preloaded patch ticks on real motion at level 0 for as long as the scene lasts (`engine.md`
§5.4). Rules:

- **Bounded state.** Every integrator is leaky and clamped (§6's `.min(4)`); PERCUSSION's
  engagement integral `engagement + (activity * tickDt)` grows for the whole load and would sound
  "seasoned" on first hearing — clamp it, or decide that is the point and say so.
- **No backlog.** No queued one-shots, no Routine that schedules ahead, no Pdef whose events
  pile up; spawn only from a gesture edge with a refractory window.
- **No charged loops.** Feedback delays, `LocalIn` loops and long reverbs fed at rest must be
  quiet at rest, or they arrive already ringing.
- **CPU budget.** Eight patches run all the time; prefer one long-lived synth per voice,
  control-rate modulators, and a rest floor that gates per-event spawning.
- **Same state on hearing.** Because both slots see the same wrist, the incoming patch is already
  in the performer's current state when the fade begins — that is desirable; design for a
  crossfade *into* a gesture in progress.

## 12. Silent within ~200 ms at `~deinit`

```supercollider
~deinit = ~deinit <> {
    var sy = synth, g = group, b = bufs;      // capture...
    synth = nil; group = nil; bufs = nil;     // ...and nil synchronously: a double fire no-ops
    Pdef(m.ptn).remove;
    if (sy.notNil) { sy.set(\gate, 0) };      // release <= 0.15 s in the SynthDef
    fork {
        if (g.notNil) { s.bind { g.freeAll }; s.sync; g.free };
        0.3.wait;                              // outlast the release before freeing buffers
        b.do { |x| x.free };
    };
};
```

- Corpus: the reference teardown captures and nils first, `var g = group;` (patching/corpus/AirConcert/personalities/SOPRANOVOICE.sc:140),
  `group = nil;` (patching/corpus/AirConcert/personalities/SOPRANOVOICE.sc:143); and waits out the release before the buffer
  free, `2.0.wait;` (patching/corpus/AirConcert/personalities/SOPRANOVOICE.sc:154) — 2 s is its pad's release, too long for this
  engine's ~200 ms: shorten the release, keep the order. Steph §5 (idempotency), §27.
