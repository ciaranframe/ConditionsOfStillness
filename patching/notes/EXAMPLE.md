# EXAMPLE (dry run) — "a breath-like sound for a still left hand over the keys"

Date: 2026-09-27 · Asked by: plan Task 10 (fictitious brief, no scene) · Scene(s): none — `patching/context/` holds only its README · Status: research (dry run; stops before the patch)
Reusable findings: the corpus has no breath patch but three wind beds and one inverted-tier "stillness is fullest" patch to build from (§3F); the template's gravity-free `energy` is the right rest detector for a hand resting on or over the keys.

> **What this file is.** The worked example of `/airkit-patch` steps 0–3 (context → brief →
> research → design note), run once to validate the skill's research stage. It is not a patch:
> no `COS_*.sc` was written and the roster is unchanged. The research was run by one agent,
> sequentially, not by six parallel subagents. Tracks E and F were run against local files;
> tracks A–D need the web and were **not run in the dry run** — each says what would be
> searched. Every "so for the patch" line under A–D is therefore a hypothesis to be checked,
> marked *(unverified)*. A real run fills those tracks with cited findings.
> If this became a patch it would be `COS_StillBreath` (one hand; no `2H`).

## 1. Brief

"a breath-like sound for a still left hand over the keys"

Read like a composer: the referent is **human breath** — not wind, not a voice: an unpitched,
aspirated noise with a slow in/out cycle and a faint resonant colour from the mouth and throat.
The gesture is **no gesture**: Zubin's left hand held still over the keyboard (the non-playing
hand, or the hand waiting to play). So the sound lives *in* stillness — the piece's subject —
and motion should thin it or let it go, not drive it. Role in the room: a halo under the piano,
never foreground; the piano must be heard through it at every dynamic.

- **Assumption:** wrist `ZL` (Zubin, left). One hand; the right hand plays normally and has its
  own sound or none.
- **Assumption:** at rest the patch breathes on its own, at roughly a resting breathing rate;
  small motion (the hand beginning to move toward the keys) shallows and quickens the breath,
  real playing lets it fade out over a couple of seconds — a held breath that is released
  when the hand plays.
- **Assumption:** unpitched, with a formant-like colour that `register` can move (so it can sit
  under a low or a high piano texture) — not a pitch set.
- **Assumption:** dry-ish; `wet` optional. No samples (synthesis first; `references/samples.md`).
- Reveal candidate: after a long stillness (tens of seconds) the breath deepens — longer cycles,
  a slightly darker colour — the "held breath of the room".

## 2. Context read

- `patching/profile.md` — the non-playing hand at low motion is ordinary, not a fault; stillness
  needs "something real to do"; peaks −12…−6 dBFS shaken hard; ensemble must be heard;
  sc3-plugins allowed; recommended scene keys (`register`, `density`, `brightness`, `rate`, `wet`).
- `patching/context/README.md` — the only file; no programme note or scene notes yet, so no
  scene constrains this sound. **Assumption:** a generic still-hand scene.
- References consulted: `engine.md` §3 (lifecycle), §4 (tick), §5.1 (scene params), §5.4
  (standby preload), §7.2 (gesture model, `accelMass` includes gravity); `patterns.md` §1
  (long-lived synth), §7 (stillness reveal), §10 (scene params), §11–12 (exit); `pitfalls.md`
  §19 (gravity), §32 (state that explodes on first hearing), §33 (idle CPU).
- Takes consulted: none recorded yet (`takes/INDEX.md` is empty). Thresholds below are the
  template's documented scale (`energy` 0 at rest, ~0.3 swaying, 2+ shaken hard); a real run
  records a still-left-hand take first.

## 3. Findings

### A — Physics — *not run in the dry run*

Would search (JASA, Acta Acustica, respiratory-acoustics literature, speech-science texts on
aspiration and /h/): breathing rate at rest (breaths per minute) and inhale:exhale ratio; the
spectrum of nasal vs oral breath noise (band centres, slope); formant positions of an /h/ or
open-mouth exhale; how loudness and spectral tilt follow airflow; the pause between breaths.
Numbers the design would lean on: cycle period, I:E ratio, the two or three band centres.

### B — Synthesis prior art — *not run in the dry run*

Would search: Farnell *Designing Sound* (wind and breath chapters — translate the model),
sccode.org / scsynth.org for "breath", "whisper", "aspiration", "noise formant"; Cook *Real
Sound Synthesis* (noise excitation of a vocal-tract model); Klatt-style aspiration source. Would
return the technique (filtered noise through two or three band-passes with an airflow envelope,
or a noise-excited formant filter) with parameter values and licences.

### C — Musical world — *not run in the dry run*

Would search: breath in contemporary instrumental writing (extended-technique breath tones,
air sounds on wind instruments, *souffle* notation), electroacoustic works built on breath, and
how an unpitched noise sits against an equal-tempered piano (pitch-neutral vs a faint formant
that implies a pitch). Would decide whether the breath cycle should lock to anything (no — no
conductor, `pitfalls.md` §20).

### D — Gesture and mapping — *not run in the dry run*

Would search: NIME papers on stillness and micro-motion as control (e.g. work on "standstill"
and micro-motion in performance), Hunt & Wanderley on mapping, wrist-IMU instruments' treatment
of rest. Hypothesis to test *(unverified)*: a many-to-one map — inverse motion → breath depth,
motion → breath rate — keeps the instrument legible; a hard threshold on stillness would make
it flicker, so use a slow follower with hysteresis.

### E — SuperCollider practice (UGens verified against the local class library; CPU)

The rendered help is absent on this machine (`~/Library/Application Support/SuperCollider/Help/Classes`
holds 6 files), so signatures were read from the class source in
`/Applications/SuperCollider.app/Contents/Resources/SCClassLibrary/Common/Audio/`:

1. `PinkNoise : WhiteNoise` (Noise.sc:162) — `ar(mul, add)`; the breath source; −3 dB/oct
   is a closer start than white for exhaled air *(tilt to be confirmed by track A)*.
2. `BPF.ar(in, freq = 440.0, rq = 1.0, mul, add)` (Filter.sc:183–185) — formant bands; `rq`
   is bandwidth/freq, so a 300 Hz-wide band at 1.5 kHz is `rq` 0.2.
3. `Resonz.ar(in, freq = 440.0, bwr = 1.0, …)` (Filter.sc:5–7) — constant-gain alternative to
   `BPF` when `bwr` is swept; `bwr` is also bandwidth ratio.
4. `Formlet.ar(in, freq, attacktime = 1.0, decaytime = 1.0, …)` (Filter.sc:335–337) — ringing
   formant; too resonant for breath at rest *(judgement, not measured)* — runner-up only.
5. `LFNoise2 : LFNoise0` (Noise.sc:219) — smooth random drift for band centres and depth.
6. `LeakDC.ar(in, coef = 0.995, …)` (Filter.sc:147–149) and `OnePole.ar(in, coef = 0.5, …)`
   (Filter.sc:15–17) — DC guard and a cheap tilt.
7. CPU method: one long-lived synth — one noise source, three band-passes, a control-rate
   breath envelope — is a handful of UGens; the audition prints `serverCpu`; eight live copies
   must stay a small fraction of scsynth (`research.md` §1E). No per-event synths, no buffers.
8. The breath cycle belongs **in the SynthDef** (an `LFTri`/`EnvGen`-shaped control-rate
   oscillator whose rate and depth are `.set` from the tick), not in a tick-side Routine — no
   `.wait` in the tick (`engine.md` §4, `pitfalls.md` §9). (`LFTri` not yet checked against the
   class source — a real run verifies it before use.)

So for the patch: `PinkNoise` → 2–3 × `BPF` (centres from `register`/`brightness`) → breath
envelope → `LeakDC` → output ceiling; everything `.set` from `~idleNext`.

### F — Steph's corpus (`patching/corpus/<branch>/personalities/<file>:<line>`; what is borrowed)

Queried `patching/corpus/index.json` (non-duplicate personalities whose name matches
breath/wind/whisper/air/sigh/blow: 20; with `PinkNoise` and `BPF`/`Resonz`: 26; with
`Formlet`/`Formant`: 0) and read `patching/corpus/digest.md` §1, §2, §4, §12, §13. No corpus file
is a breath; the nearest are wind beds and one stillness-first chord.

1. `AirConcert/personalities/WINDY.sc:122` — `base = PinkNoise.ar * LFNoise2.kr(breezeSpeed).range(0.7, 1.0);`
   then `RLPF` with a drifting cutoff (:125–129): the noise-bed shape to borrow.
2. `AirConcert/personalities/WINDY.sc:216` — `masterAmp.lagud(0.6, 6) * 4`: slow-fall
   smoothing in the SynthDef (digest §4) — a breath that outlasts a movement.
3. `AirConcert/personalities/WINDY.sc:394` — `m.accelMassFiltered.lincurve(0, 1.0, -80, -15, -1).dbamp`:
   motion → dB law (digest §1) — here **inverted**: motion lowers the breath.
4. `AirConcert/personalities/cotf_whisperer1.sc:142` — `{ true } { \high };`: the inverted
   tier, where stillness is the fullest state (digest §12) — the design's core idea.
5. `AirConcert/personalities/cotf_whisperer1.sc:148` — `lastMotion = now;`: the stillness clock
   for a reveal; its ghost-echo fire was never finished (digest §12, `patterns.md` §7).
6. `AirConcert/personalities/RainKeys.sc:279` — `((m.accelMassFiltered - 0.25).max(0) * 0.7).clip(0, 1)`:
   a gravity rest floor (digest §2); superseded here by the template's adaptive `grav`/`energy`
   (`airkit/personalities/COS_Template.sc:35`), which is 0 at rest in any orientation.
7. `AirConcert/personalities/WindVoice.sc:221` — `if (in < thresh) { 0 } {`: a dead zone —
   the shape for "still enough to count as rest".
8. `Airsticks-RPI/personalities/violin2.sc:78` — `m.accelMassFiltered.lincurve(0.5,2.5,0.01,2,-2)`:
   motion sets a scan speed so stillness freezes the sound — the alternative reading (a frozen
   breath) the design rejected in favour of a living cycle.

Borrowed: the pink-noise bed with drifting filter (1), slow-fall amp smoothing (2), the inverted
motion law (3–4), the stillness clock (5). Not borrowed: `ctx.loudness`, beat hooks, literal
SynthDef names (`\forestBreeze` is unprefixed — `pitfalls.md` §28).

## 4. Design (provisional — tracks A–D not run)

- **Technique** — pink noise through 2–3 band-passes (formant colour), amplitude and band
  centres shaped by a control-rate breath cycle inside one long-lived synth. Runner-up:
  `Formlet`-excited noise (more vocal, rings too much at rest). Chosen for CPU × 8 and because
  it degrades gracefully on a small PA.
- **Idiom** — `patterns.md` §1 long-lived synth + `.set`, with §7 stillness reveal.
- **Parameters** —

| parameter | value | from finding |
|---|---|---|
| breath period at rest | *(from track A)* | A — not run |
| inhale : exhale | *(from track A)* | A — not run |
| band centres | *(from tracks A/B; scaled by `register`)* | A, B — not run; E-2 for `rq` |
| amp smoothing | rise ~0.6 s, fall ~6 s | F-2 |
| rest detector | template `energy`, rest < ~0.05 with hysteresis | F-6, F-7; `patterns.md` §7 |
| reveal delay | ~10 s of stillness | F-5 (whisperer's >10 s) |

- **Pitch world and time** — unpitched; `register` moves the formant bands as a colour, not a
  note. Time is the breath's own cycle; no clock.
- **Mapping** —

| gesture (piano terms) | model source | → parameter | in range | out range | curve / smoothing | why |
|---|---|---|---|---|---|---|
| left hand resting still over the keys | template `energy` | breath depth (amp) | 0 … 0.3 | full … −30 dB | inverted, slow fall | stillness is the fullest state (F-4) |
| hand starting to move / preparing to play | `energy` | breath rate | 0 … 0.3 | 1× … ~2× | lincurve, 1 s lag | the breath quickens before playing *(unverified)* |
| playing (key attacks, rolled chords) | `energy` > 0.3 | fade out | — | to silence over ~2 s | lagud | the breath is let go when the hand plays |
| forearm tilt over the keyboard | `gyroYFiltered` | band-centre offset | −1 … 1 | ±3 semitones of colour | 2 s lag | slow register colour (digest §5) |

- **At rest / stillness** — a quiet, living breath cycle; after ~10 s still, one deeper, darker
  breath (reveal), re-armed by motion.
- **Two-hand** — n/a.
- **Standby and exit** — nothing accumulates: the stillness clock is a timestamp, the reveal a
  one-shot flag; release ≤ 0.15 s on `gate` 0 (`patterns.md` §12).
- **Level and CPU** — halo level: breath peaks well below the plan's −12…−6 dBFS (it is loudest
  at rest, where the piano may be quiet — calibrate against a take); an output ceiling
  by gain and `.clip`; one synth, no buffers.
- **Samples** — none.

## 5. Params

| key | type / range | default | what it changes audibly |
|---|---|---|---|
| `register` | `low` \| `mid` \| `high` | `mid` | where the breath's formant colour sits |
| `brightness` | 0–1 | 0.4 | band-pass centres and tilt: a darker or airier breath |
| `rate` | Hz | *(track A's resting rate)* | the breath cycle at rest |
| `wet` | 0–1 | 0.1 | a little room around the breath |

Header line: `params: register (low|mid|high, mid), brightness (0–1, 0.4), rate (Hz, tbd), wet (0–1, 0.1)`

## 6. Hand-off

Not reached (dry run stops after the note). What it would say: rest the left hand over the
keys and hear a slow breath; begin to move toward the keys and the breath quickens and thins;
play and it lets go; stay still for ten seconds and it takes one deep breath.
Checks: lint —; compile —; audition —; samples none.

## 7. Sources

- `patching/profile.md`; `patching/context/README.md`.
- `.claude/skills/airkit-patch/references/engine.md` §3–§7, `patterns.md` §1, §7, §10–12, `pitfalls.md` §9, §19, §20, §28, §32, §33, `research.md`.
- `patching/corpus/digest.md` §1, §2, §4, §5, §12; `patching/corpus/index.json` (queries above).
- Corpus files and lines as cited in §3F (raw files in the main checkout).
- `airkit/personalities/COS_Template.sc:35` (the gravity-free `energy`).
- `/Applications/SuperCollider.app/Contents/Resources/SCClassLibrary/Common/Audio/{Noise.sc,Filter.sc}` — UGen signatures.
- Web sources: none (tracks A–D not run).

## 8. Iteration log

2026-09-27 — dry run of the research stage for Task 10 of the patch-skill plan; kept as the example note.
