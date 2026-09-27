# Corpus digest — what Steph's personalities actually do

The corpus is every `personalities/*.sc` and `synths/*.sc` on five AirKit branches: 574 entries,
561 unique blobs, 14 duplicates, 459 unique personalities (`stats.md`) — `Airsticks-RPI` 233,
`Airsticks-Desktop` 187, `MiMBrentonShows` 130, `master` 71, `AirConcert` 32. Three eras.
`master` and `MiMBrentonShows` are the Music-in-Motion show files: MIDI out (`~nextMidiOut`,
`m.midiOut`), the old engine's `~onHit`/`~onMoving` edges, camera-blob fields on some devices,
pitch passed between sticks through `m.com`. `Airsticks-RPI`/`-Desktop` add visual events
(`~vdef`, `\customVisualEvent`), sample libraries under `~/Music/yourDNASamples`, and the first
`cotf_*` files. `AirConcert` is the Concerts-of-the-Future production set: room states, beat
hooks from a conductor, the header block, the load barrier, per-env event types. Headers: 51 of
459 files have one; 50 carry `gestures/description/sound/pitch/rhythm/instruments`, 13 add
`seats/affinity/register/family` (12 also `prints`), 12 add `internals` — all COTF-era. Idioms
over the 459: `pdef` 235, `synth` 168, `hybrid` 31, `none` 24, `ndef` 1. 42 % read samples;
median 118 lines; `accelMassFiltered` is read by 391 files, `rrateMassFiltered` by 187,
`gyroYFiltered` by 81 — tilt and rotation are the minority channels.

Pointers are `(<branch>/<path>:<line>)` under `patching/corpus/` in the **main checkout** (raw
files are gitignored; one copy per blob, the `raw` field of `index.json`); the backticked text
before a pointer is on that line. This is research track F's first stop (`research.md`): find the
logic here, read the 2–5 cited files in full, re-host the *logic* in `~idleNext`, cite the source
line. It records what the corpus does and where; `patterns.md` holds the shapes to copy,
`pitfalls.md` the rules. The engine wins wherever the corpus differs: there is no conductor, so
`ctx.voicePool`, `ctx.loudness`, beat hooks and `~onResync` never fire here; room state is always
`\idle` (the `~tuning/~piece/~curtainNext` bodies below are logic to lift, not states to expect);
`~onHit`, `~onMoving`, `m.com` are not dispatched; scene params (`~sceneParams`) and `~partner`
are new and have no corpus prior art.

## Recurring logics

**1. Motion → decibels → `.dbamp`, floor at silence.** Every era maps one motion magnitude
through `lincurve` into dB with a −50…−90 dB floor and mostly negative curves (−1…−4), then `.dbamp`.
*Here:* the default loudness law for any wrist; tune the input span to a take (piano motion is
small — a 0–0.5 span, as PLUKSYNTH uses, not 0–2.5). Replace `ctx.loudness` with a scene param.
`m.accelMassFiltered.lincurve(0, 0.5, -70, -14, -1)` (AirConcert/personalities/PLUKSYNTH.sc:255),
`(m.accelMass + m.rrateMass).lincurve(0, 2.0, -90, -10, -1)` (AirConcert/personalities/cotf_simple1.sc:114),
`m.accelMassFiltered.lincurve(0, 1.4, -50, -5, -1)` (Airsticks-RPI/personalities/_TEMPLATE_ak_pfile.sc:112),
`ctx.loudness.linlin(0, 1, 0.3, 1.0)` (AirConcert/personalities/WINDY.sc:433).

**2. Gravity-aware rest floor.** `accelMass` never reaches 0 on a still stick (~0.2–0.3 from
gravity), so COTF files subtract a floor or force exact zero below a dead zone.
*Here:* the non-playing hand and damping must read as rest, not as quiet playing; decide the
floor from a stillness take. `((m.accelMassFiltered - 0.25).max(0) * 0.7).clip(0, 1)` (AirConcert/personalities/RainKeys.sc:279),
`if (raw > deadZone,` (AirConcert/personalities/cotf_orchDrums1.sc:380),
`if (in < thresh) { 0 } {` (AirConcert/personalities/WindVoice.sc:221),
`if(m.accelMass < 0.2,{` (master/personalities/pluck1.sc:69).

**3. Combining acceleration and rotation.** Three forms: plain sum (older), `max` (either
gesture drives it), and a fuzzy OR that saturates at 1 but reads two mid gestures hotter.
*Here:* a rolled chord is rotation, a key attack is acceleration; `max`/fuzzy-OR lets either
hand technique wake the same sound. `a + r - (a * r)` (AirConcert/personalities/STRINGCHORD.sc:73),
`var rain = max(spin, energy);` (AirConcert/personalities/RainKeys.sc:280),
`var wind = max(max(spin, energy), loud * 0.5);` (AirConcert/personalities/WindVoice.sc:317).

**4. Asymmetric smoothing.** Each file sets its own attack/decay on the model's filters (fast
rise, slow fall = envelope follower), or rolls its own one-pole with separate rise/fall rates,
or leaves it to `lagud` in the SynthDef. *Here:* slow fall for beds that should outlast a
stroke; fast fall where damping must cut. `m.accelMassFilteredAttack = 0.99;` (AirConcert/personalities/PERCUSSION.sc:267),
`droneAmpSmooth = if(drive > droneAmpSmooth, {` (Airsticks-RPI/personalities/metal1.sc:167),
`masterAmp.lagud(0.6, 6)` (AirConcert/personalities/WINDY.sc:216).

**5. Tilt → pitch index, octave with hysteresis.** Up/down tilt `gyroEvent.y / pi.half`
(−1…1) indexes a note array or picks an octave; yaw (`gyroEvent.z`) is used once. Note changes
are throttled or given hysteresis so a wrist on a boundary does not chatter.
*Here:* forearm angle over the keyboard is slow and deliberate — a register control, not a
melody. `.linlin(-1, 1, 0, idleNotes.size - 0.001).asInteger.clip(0, idleNotes.size - 1)` (AirConcert/personalities/WINDY.sc:391),
`tiltOct = switch(tiltOct,` (AirConcert/personalities/BIRDY.sc:434),
`if (TempoClock.beats > (lastTime + 2.0), {` (AirConcert/personalities/WINDY.sc:397),
`var index = (d.sensors.gyroEvent.z / pi).linlin(-1.0,1.0,notes.size,0);` (Airsticks-RPI/personalities/LR_pitch.sc:50).

**6. One gesture axis per parameter.** The COTF files keep a fixed split so an instrument stays
learnable: roll (`gyroEvent.x`, folded) → cutoff, twist (`rrateMass`) → resonance/buzz,
acceleration → decay, tilt → register. Older files also read single accelerometer axes.
*Here:* write the split into the header's `gestures:` and keep it across states.
`roll  (gyro x)  -> filterFreq` (AirConcert/personalities/PLUKSYNTH.sc:197),
`var res   = m.rrateMassFiltered.lincurve(0, 1.2, 0.7, 0.25, -1);` (AirConcert/personalities/PLUKSYNTH.sc:208),
`var dcy   = m.accelMassFiltered.lincurve(0, 2.0, 0.6, 1.8, -1);` (AirConcert/personalities/PLUKSYNTH.sc:209),
`(d.sensors.accelEvent.y.abs + d.sensors.accelEvent.z.abs)` (Airsticks-RPI/personalities/droplet.sc:190).

**7. Strike detection with a refractory window; accents over a bed.** A threshold on filtered
(COTF) or raw single-axis (older) acceleration, plus `TempoClock.beats > lastTime + w`
(default clock, so `w` is seconds). Accents on top of a running pattern use a higher threshold
(cotf_test1); one file steals its single accent voice (release the last, start the next).
*Here:* drum strokes. The raw, signed axis is the only form that sees stroke *direction*; a
55 ms window is shorter than the ~50–100 ms rebound `patterns.md` infers — calibrate on a take.
`if (m.accelMassFiltered > 0.5, {` (AirConcert/personalities/cotf_drums1.sc:174),
`if(d.sensors.accelEvent.x > (1.0 * sens), {` (Airsticks-RPI/personalities/trainMove2.sc:406),
`if(TempoClock.beats > (lastTime + 0.055),{` (Airsticks-RPI/personalities/trainMove2.sc:408),
`if(TempoClock.beats > (lastTime + (dur*4)),{` (Airsticks-RPI/personalities/swing1.sc:127).

**8. Rotation or energy → subdivision.** `\dur` from rotation rate (continuous `lincurve`/
`linexp`, or a reciprocal), or from energy quantised to powers of two so the grid survives.
*Here:* a pianist's tremolo is fast low-amplitude rotation — it can drive density directly; the
power-of-two form suits the drummer's rolls. `m.rrateMassFiltered.lincurve(0.01, 1.0, 2.0, 0.25, -4)` (AirConcert/personalities/cotf_test1.sc:293),
`0.5 * 2.pow(m.accelMassFiltered.lincurve(0,2,0,3,-1).floor).reciprocal` (Airsticks-RPI/personalities/funBass.sc:181),
`var dur = m.rrateMassFiltered.linexp(0,0.3,0.35,0.09);` (Airsticks-RPI/personalities/swing1.sc:86),
`rateValue = (1.0 + (m.rrateMassFiltered * 8)).reciprocal;` (MiMBrentonShows/personalities/eve3.sc:151).

**9. Energy → how much of the material plays.** Three forms: stepped `\dur` tiers with a
throttle on switching; a `Pslide` window whose width grows with energy (still = one repeated
note); a per-hit threshold that lets ghost notes through only while the hand moves.
*Here:* motion opening a chord or a groove from its core; ghost notes as the drummer's roll
fills in. `{ amp > -10.1 }, {` (AirConcert/personalities/JUPITERSHARP.sc:246),
`\slideIdx, Pslide(Array.series(maxRange, 0, 1), inf, Pkey(\range), 0, 0),` (AirConcert/personalities/STRINGCHORD.sc:160),
`var range = m.accelMassFiltered.lincurve(0, 2.5, 1, maxRange, -1).floor;` (AirConcert/personalities/STRINGCHORD.sc:279),
`var thresh = 0.4 * (1 - motion);` (AirConcert/personalities/cotf_orchDrums1.sc:270).

**10. Tiers and small state machines.** Tier from activity with separate rise/fall
thresholds, from tilt bands, or from an engagement integral; the tier selects voice count,
pattern or arpeggio length. *Here:* the tier *changes* are the musical events — a crossing
into `\high` can be an accent; remember the integral must be clamped (patterns §6, §11).
`\low,  { if (activity > 0.60) { \med } { \low } },` (AirConcert/personalities/PERCUSSION.sc:551),
`currentLayer = if (y < -0.33) {` (AirConcert/personalities/cotf_orchDrums1.sc:402),
`var lengthBonus = engagement.linlin(0, 300, 0, 2).round.asInteger;` (AirConcert/personalities/cotf_cascade1.sc:183),
`var amps = switch(tier,` (AirConcert/personalities/cotf_whisperer1.sc:54).

**11. Pause the pattern when still, resume on motion.** The most common gate in the
pre-COTF branches: one threshold, `isPlaying` check, `pause`/`resume(quant:)`.
*Here:* cheap when unheard (a paused Pdef spawns nothing on a standby slot), but add
hysteresis — a single threshold at 33 Hz flaps — and a small quant on `~beatClock`.
`if( Pdef(m.ptn).isPlaying.not,{` (Airsticks-RPI/personalities/funBass.sc:198),
`if(m.rrateMassFiltered > 0.01,{` (Airsticks-RPI/personalities/LR_pitch.sc:54),
`if (Pdef(m.ptn).isPlaying.not, {` (AirConcert/personalities/cotf_drums1.sc:201),
`Ndef(m.ptn).pause();` (Airsticks-RPI/personalities/ndefTest1.sc:63).

**12. Stillness as a sound, not a gap.** Three shapes exist: an inverted tier where rest is the
*fullest* state (whole chord still, thinning to the root as the hand moves); a time-stretch
whose scan speed follows motion, so stillness freezes the sound in place; a repeated single
note that motion widens. Nothing in the files read *fires* on sustained stillness — whisperer keeps
the clock but its ghost echo is an open TODO. *Here:* the piece's central state; build the
trigger (patterns §7) on top of one of these beds.
`{ true }            { \high };` (AirConcert/personalities/cotf_whisperer1.sc:142),
`var speed= m.accelMassFiltered.lincurve(0.5,2.5,0.01,2,-2);` (Airsticks-RPI/personalities/violin2.sc:78),
`hold it still and it holds one repeating note` (AirConcert/personalities/STRINGCHORD.sc:3),
`lastMotion = now;` (AirConcert/personalities/cotf_whisperer1.sc:209).

**13. Put-down and damping.** When energy drops, let the current note finish but drop the
rest of the phrase; fall fast on the amplitude filter so a set-down stick stops ringing; hard
zero on texture density at rest. *Here:* the drummer's damping (still right after a stroke) and
the pianist lifting off — the release gesture should be audible as an ending.
`queue = queue.keep(1);` (AirConcert/personalities/BIRDY.sc:411),
`m.accelMassFilteredDecay  = 0.25;` (AirConcert/personalities/PLUKSYNTH.sc:71),
`weather.set(\dens, 0, \bed, 0);` (AirConcert/personalities/RainKeys.sc:290),
`synth.set(\gate,0);` (master/personalities/pluck1.sc:70).

**14. Pdef on a clock, retuned from the gesture.** COTF files keep routing in the Pbind and
every mapping in `Pdef(m.ptn).set` from the tick, seeded silent; `Pbind` keys override `.set`,
so controls stay out of the Pbind. BIRDY goes further: a `\dur` Pfunc pulls notes off a
language-side phrase queue and reads controls back as `e[\key]`, spawning nothing below an
amp floor. *Here:* phrase-shaped material (a figure per gesture, not a loop) on the free clock.
`\dur,  Pfunc { |e| step.(e) }` (AirConcert/personalities/BIRDY.sc:491),
`var amp     = (e[\amp] ? 0);` (AirConcert/personalities/BIRDY.sc:386),
`if (muted.not and: { group.notNil } and: { amp > ampFloor }) {` (AirConcert/personalities/BIRDY.sc:392),
`is deliberately NOT a Pbind key` (AirConcert/personalities/cotf_orchDrums1.sc:300).

**15. Long-lived voices, reshaped each tick.** Beyond the plain drone: a retriggerable exciter
envelope *inside* the held synth (the drone sings, strikes add a burst through the same
filter); three held voices with staggered lag times so a chord blooms rather than switches;
`Dust` density as a control of a single texture synth instead of spawning events.
*Here:* piano sustain with strike colour; a drum-roll texture without per-event synths.
`var trig = \trig.tr(0);` (AirConcert/personalities/ALTOSYNTH.sc:58),
`if (synth.notNil and: { m.accelMassFiltered > excThreshold }) {` (AirConcert/personalities/ALTOSYNTH.sc:76),
`\lagRelease, 4` (AirConcert/personalities/cotf_whisperer1.sc:158),
`var t = Dust.ar(densL * 1.2);` (AirConcert/personalities/RainKeys.sc:108).

**16. Sample maps and pitch-shifting samples.** Sparse libraries: odd MIDI borrows the even
sample below at +1 semitone; nearest-neighbour lookup with `midiratio`; for a pitched drum,
two sources a fifth apart, each note taking the nearer (shift ≤ a minor third); a piano example
indexes dynamic layers. Roll can scrub a sample's start point. *Here:* velocity layers
for piano-hand strength; a tuned bass-drum sample. Paths come from `~cosSamples` only.
`if(~note.odd,{` (AirConcert/personalities/JUPITERSHARP.sc:117),
`var src = timpSamples.minItem({|t| (timpNote - t.srcMidi).abs });` (AirConcert/personalities/PERCUSSION.sc:389),
`var dynamicOffset = dynamic * 23;` (Airsticks-RPI/synths/pianoSamplerExample.sc:31),
`var start = d.sensors.gyroEvent.x;` (master/personalities/timDrums.sc:104).

**17. Granular and stretched beds.** A granular drone over the *same* samples the notes use
(a mono mirror buffer per file), sitting under the melody; `GrainIn` over live noise (no
buffer); `Warp1` stretch clouds. dulcimer notes that GrainBuf's rate needs `BufRateScale` when
the file's rate differs from the server's — moot here, `samples-check` converts to 48 kHz.
*Here:* a resonance bed that "remembers" what the hand played.
`var monoBuffer = Buffer.readChannel(s, path.fullPath, channels: [0]);` (AirConcert/personalities/cotf_dulcimer1.sc:232),
`var sig   = GrainBuf.ar(2, trig, grainDur, bufnum, grate, gpos, interp, gpan, envbuf);` (AirConcert/personalities/cotf_dulcimer1.sc:167),
`sig = GrainIn.ar(` (AirConcert/personalities/WINDY.sc:241),
`Warp1.ar(1, buffer` (Airsticks-RPI/personalities/violin2.sc:43).

**18. Gesture one-shots.** Events built inline in the tick and `.play`ed into the patch's
Group; arpeggios scheduled note by note on `SystemClock`; self-freeing by `DetectSilence` or a
fixed envelope; one older file frees by a late `/n_set gate 0` bundle.
*Here:* strokes and chords; always into your Group, with a nil-group guard (see traps).
`group:      group,` (AirConcert/personalities/cotf_test1.sc:245),
`SystemClock.sched(i * noteInterval, {` (AirConcert/personalities/cotf_cascade1.sc:95),
`DetectSilence.ar(sig, time:0.3, doneAction:2);` (AirConcert/personalities/BIRDY.sc:260),
`synth.server.sendBundle(0.3,[\n_set, synth.nodeID, \gate, 0]);` (Airsticks-RPI/personalities/ROLL_duration.sc:79).

**19. Direction, reversal, onsets, flicks.** Sign of the tilt difference classifies up/down;
a change inside 0.5 s is a reversal (chord instead of arpeggio); a rising edge across the rest
floor starts a phrase at once; a rotation spike with a 1.2 s refractory raises a flag the
pattern spends; the rectified derivative of a feature is an onset measure.
*Here:* a rolled chord (turn), a key attack (edge), a drummer's lift-and-strike (reversal).
`var newDir = case` (AirConcert/personalities/cotf_cascade1.sc:162),
`{ urgent = true };` (AirConcert/personalities/BIRDY.sc:432),
`if ((twist > 0.8) and: { TempoClock.beats > (lastFlick + 1.2) }` (AirConcert/personalities/BIRDY.sc:443),
`rate = ((m.accelMassAmp - oldVar) * 10.0);` (MiMBrentonShows/personalities/energy.sc:119).

**20. Smaller idioms worth knowing.** Orientation *sampled at the strike* and frozen into the
event (the sound keeps the angle it was struck at); a per-device sensitivity param scaling
every threshold — the only prior art for scene params; loudness compensation across register;
a string grid DSL for drum patterns (`K`/`k`/`.`/digits = full/ghost/rest/level).
`var hg = d.sensors.gyroEvent;` (Airsticks-RPI/personalities/trainMove2.sc:419),
`var sens = d.params.sensitivity;` (Airsticks-RPI/personalities/trainMove2.sc:380),
`freqComp = { |freq| (2000 / freq).sqrt.clip(0.45, 1.3) };` (AirConcert/personalities/BIRDY.sc:269),
`var parseGrid = {|str|` (AirConcert/personalities/cotf_orchDrums1.sc:84).

## Traps seen

Rule ids are from `patching/tools/src/lint.ts`; counts are from running `patch-lint.ts` over
all 459 unique corpus personalities. Absent from the corpus: `s.sync`/`Buffer.read` in a tick
(`tick.blocking` 0 files) and explicit `topEnvironment[...] =` writes (`banned.global-write`
0) — their nearest relatives are T7 and T12. "No rule" marks a lint gap: review catches it.

- **T1 Machine paths for samples.** `/Users/soh_la/Downloads/` (master/personalities/timDrums.sc:21);
  COTF's `"~/Music/cotf_samples/voice/aah.wav"` (AirConcert/personalities/SOPRANOVOICE.sc:34). `banned.abs-path`
  (194 files), and the `Buffer.read` on them `sample.manifest` (193).
- **T2 Global SynthDef names.** `SynthDef(\simple, {` (AirConcert/personalities/ALTOSYNTH.sc:53) is also
  `\simple` with different arguments in BASSBUZZ, cotf_simple1, cotf_test2: last load wins for
  every slot. `synthdef.prefix`, `synthdef.collision` (69 files reuse a name already in `airkit/personalities`).
- **T3 Global event-type name.** `Event.addEventType(\customEvent, {|e|` (Airsticks-RPI/personalities/UD_pitchDynamics2.sc:114):
  a second sampler patch plays the first one's samples. COTF's fix is per-env
  `(\customEvent_ ++ m.ptn).asSymbol` (AirConcert/personalities/JUPITERSHARP.sc:52). No rule.
- **T4 Literal pattern keys.** `Pdef(\pb,` (master/personalities/timDrums.sc:46) — `pdef.literal-name`;
  `Pbindef(\ap,` (Airsticks-RPI/personalities/ndefTest1.sc:21) is the same bug and is not matched.
- **T5 Server-wide teardown.** `s.freeAllBuffers;` (Airsticks-RPI/personalities/UD_pitchDynamics2.sc:159) frees every
  slot's samples; `Pdef.removeAll;` (master/personalities/timDrums.sc:72) stops every slot's
  patterns. No rule (`banned.server-control` matches `s.freeAll` only).
- **T6 Clobbered or missing `~deinit`.** `~deinit = {` (master/personalities/timDrums.sc:71) — `style.compose`
  (14 files clobber a hook); a file with only `~stop = {` (master/personalities/pluck1.sc:26) and a synth
  that never frees — `hooks.required`.
- **T7 Shared env written from inside `topEnvironment.use`.** `~buffers = folder.entries.collect({|path,i|`
  (AirConcert/personalities/cotf_drums1.sc:56) lands in `topEnvironment[\buffers]`, shared by
  drums1–4 and every slot. No rule (`banned.global-write` sees only the explicit forms).
- **T8 `\silent` unhandled, and room state read bare.** An empty `~onRoomState = { |ctx|`
  (AirConcert/personalities/cotf_cascade1.sc:266) — `state.silent-unhandled`; the same file tests
  `~roomState != \silent` (AirConcert/personalities/cotf_cascade1.sc:174), nil in the patch env. No rule for that.
- **T9 Hard-wired output bus.** `Out.ar(0, snd);` (Airsticks-RPI/personalities/wingChimes1.sc:18) bypasses the
  slot's bus, level and crossfade. No rule (`banned.outbus-rewire` covers `~outBus =` only).
- **T10 Array edge and a floor above unity.** `.linlin(-1, 1, 0, ideleNotes.size, 1).asInteger`
  (AirConcert/personalities/ALTOSYNTH.sc:128) reaches `size` at full tilt → nil;
  `lincurve(0, 2.0, 0.5, 1, -3).dbamp` (AirConcert/personalities/SOPRANOVOICE.sc:192) is > 1 at rest. No rule.
- **T11 One-shots that outlive the patch.** `SystemClock.sched(i * noteInterval, {` (AirConcert/personalities/cotf_cascade1.sc:95)
  keeps firing after `~deinit` with `group` nil (the default group); a tick's deferred set,
  `.defer(0.4)` (AirConcert/personalities/ALTOSYNTH.sc:147), lands late. No rule; the audition shows it.
- **T12 Slow or hard exits.** `2.5.wait;` (AirConcert/personalities/cotf_whisperer1.sc:96),
  `Ndef(m.ptn).clear(4);` (Airsticks-RPI/personalities/ndefTest1.sc:39), `synth.free;` (Airsticks-RPI/personalities/violin2.sc:70)
  with its buffer freed on the next line. The ~200 ms silence rule; no lint rule.

## Worth stealing for Conditions of Stillness

- `AirConcert/personalities/BIRDY.sc` — phrase-per-gesture engine: rising-edge start, flick
  flag, put-down truncation, tilt octave with hysteresis; a pianist's phrase that begins when the
  hand moves and ends when it rests.
- `AirConcert/personalities/PLUKSYNTH.sc` — the one-axis-per-parameter split and "hit harder =
  ring longer"; maps straight onto a piano attack or a drum stroke's weight.
- `AirConcert/personalities/cotf_orchDrums1.sc` — motion-gated ghost notes, dead zone, grid DSL:
  a bass-drum roll that fills in as the stroke rate rises.
- `AirConcert/personalities/PERCUSSION.sc` — hysteretic tiers and a pitched drum from two
  sources a fifth apart; clamp its engagement integral before reuse.
- `AirConcert/personalities/cotf_whisperer1.sc` — stillness as the fullest state, staggered
  lags; the base for a stillness reveal (its ghost echo was never finished).
- `AirConcert/personalities/STRINGCHORD.sc` — fuzzy-OR energy; still = one repeated note, motion
  widens the window; a tremolo could widen a figure out of one note.
- `AirConcert/personalities/RainKeys.sc` — gravity-subtracted energy → `Dust` density in one held
  synth, exact zero at rest; a tremolo or a drum roll as texture density, cheap when unheard.
- `AirConcert/personalities/ALTOSYNTH.sc` — exciter burst inside a sustained voice: a held
  resonance that each stroke re-excites (drum) or each chord colours (piano).
- `AirConcert/personalities/cotf_cascade1.sc` — direction and reversal → arpeggio vs chord: the
  rolled chord and the drummer's lift-strike; add a group guard to its scheduled notes.
- `Airsticks-RPI/personalities/trainMove2.sc` — signed single-axis strike, attitude frozen at the
  strike, sensitivity scaling every threshold (read it as a scene-param model).
- `Airsticks-RPI/personalities/violin2.sc` — `Warp1` scan speed from motion: stillness freezes
  the sound; the most direct "stillness holds the moment" mechanism in the corpus.
- `Airsticks-RPI/synths/membraneDrum.sc` — modal membrane with `tension`, `damping`, strike
  `position`: a bass-drum voice whose damping can follow the hand laid on the head.

None of these is two-handed; the only cross-stick prior art is `m.com` pitch passing, which the
engine replaces with `~partner` (patterns §9).

## Method note

AirConcert, in full: `_TEMPLATE_authored`, ALTOSYNTH, BASSBUZZ, BIRDY, PERCUSSION, JUPITERSHARP,
PLUKSYNTH, RainKeys, STRINGCHORD, WINDY, SOPRANOVOICE, cotf_drums1 (2–4 by diff), orchDrums1,
cascade1, whisperer1, test2, simple1; dulcimer1, test1, WindVoice in large part; headers and
targeted reads of Birdsong, WHIPBIRD, celesta1, harpsichord1, marimba1/2, simple3, voice1. Older:
Airsticks-RPI `_TEMPLATE_ak_pfile`, funBass, wingChimes1, LR_pitch, ROLL_duration,
UD_pitchDynamics2, swing1, droplet, ndefTest1, violin2, metal1 and trainMove2 (the largest; key
blocks), insects1 (most UGens; skim), `synths/membraneDrum`, `synths/pianoSamplerExample`;
master pluck1, rain, timDrums; MiMBrentonShows eve3, energy. Chosen by: the AirConcert set,
largest files, most UGens, every idiom (`ndef`, `hybrid`, `none`), `~onHit`/`~onMoving`/`isHit`
users, gyroZ and threshold readers, sample users, every branch. Every pointer was checked by a
script (the equivalent of `grep -n`): line *n* of `patching/corpus/<path>` in the main checkout
contains the backticked text; lint counts are `patch-lint.ts --json` over the 459 (2026-09-27).
