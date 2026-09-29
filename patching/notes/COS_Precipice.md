# COS_Precipice — "a choral hum that wavers and whimpers with the slightest motion; one note for all four sticks"

Date: 2026-09-29 · Asked by: Ciaran (in session) · Scene(s): the intro of the piece — `patching/context/` holds only its README, so the brief is the context · Status: **heard by Ciaran and locked** (2026-09-29, iteration 5, AirKit 3339afc) — AUDITION PASS on synthetic, Still1, Still2, Writing1
Reusable findings: the adaptive **unrest** measure (§4, log₂ of motion over a slow-tracked floor with a dead zone) is the right stillness meter for any patch in this piece; the Still1/Still2/Still3 take statistics (§2) are the calibration table for "how still is still"; NHHall at ~0.3 % per copy is the affordable per-slot halo (§3E).

## 1. Brief

"It is for the intro of the piece, so Zubin and Claire's arm will be acting much like Still1 and Still2 recorded gestures. The idea is the patch is extremely sensitive in terms of motion. It is a choral hum, a cry for help, wimpering, high (like 2 octaves above middle C sort of around there), rich voicing all synth generated, reverb in a sort of halo around the sound. When the AirStick even slightly moves, the patch wavers and wimpers as if it about to tip and fall off the precipice (e.g. perhaps detuning into beautiful harmonics and quarter tones). In its normal, non-moving state it should pick just one note (so all four sticks will be hovering on a single note, maybe slight detune). Inspiration might be taken from Gamelan Gongs, or choirs, or children's voices. Performers will be holding their arms still to see how LITTLE they can move (it is a challenge to see how still they can be) so maybe even create a dynamic sensitivity that is adaptive to energy."

Read like a composer. The referent is a **high held hum** — a choir or a child's voice on C6, the top of a treble voice, where a voice is already close to breaking — and its two ways of failing: the *whimper* (small sobbing glides, tremor, jitter) and the *tip-over* (the note lets go of its pitch and slides toward a neighbouring harmonic or a quarter tone before being pulled back). Underneath, a gamelan idea: four instruments on one note, deliberately a few hertz apart so the unison breathes (ombak). Role in the room: a **halo** — the ensemble is silent or barely present at the opening, but the four copies together must stay a texture, not a chord and not a foreground. The gesture is **no gesture**: two performers with their arms out, trying not to move; the sound is a meter of how well they succeed, so the map must be legible to the audience (one axis — unrest — drives everything) and sensitive enough to hear the difference between Still1 and Still2 (§2).

- **Assumption:** one-hand patch on all four wrists at once (`ZL ZR CL CR`), no `2H`; every copy is identical except a fixed per-wrist ombak offset, so the four converge on one note without talking to each other.
- **Assumption:** the reference is equal-tempered C6 (MIDI 84, 1046.5 Hz). A real piano's C6 is stretched ~+8…+15 cents sharp; if the piano enters on this note, retune with the actual instrument (open question §6).
- **Assumption:** at rest the hum is *audible* (a designed rest sound, ~−26 dBFS peak per copy, four copies ≤ −14 dBFS), not silent; the audition is run with `--rest-max -18`.
- **Assumption:** "adaptive sensitivity" means two things at once: the meter normalises to the performer's own noise floor (so the stiller they get, the finer the resolution), *and* sustained stillness is rewarded with a slow bloom (the reveal), so it is never "the same sound for everyone".
- **Assumption:** the departures are drawn from a small ordered set (§4 pitch world) so they are always "beautiful" — shimmer, quarter tone, just harmonic — never a free glissando.

## 2. Context read

- `patching/profile.md` — level plan (−12…−6 dBFS peaks shaken hard; the ensemble must be heard), stillness must be designed, one-hand vs `2H` contract, recommended params (`register`, `pitchset`, `brightness`, `wet` used), roster/template/naming rules.
- `patching/context/README.md` — the only file; no programme note or scene notes exist yet. The brief above stands in for the scene note.
- References consulted: `engine.md` §2–§5, §7 (gesture model, `accelMass` includes gravity on AirKit sticks), §8; `patterns.md` §1 (long-lived synth), §6 (tiers), §7 (stillness reveal), §10 (params), §11 (cheap when unheard), §12 (deinit); `pitfalls.md` §8, §19, §22, §29, §31–§33, §37, §40.
- Takes consulted (this Mac, blank stick `X0` on Ciaran's wrist, Glimmer C-stick firmware — **linear acceleration, gravity already removed**, unlike the AirKit sticks; the template's `grav` follower makes the patch indifferent to which):

| take | what | template `energy` p50 / p90 (33 Hz, after 3 s warm-up) | rrateMass p50 / p90 (rad per packet) |
|---|---|---|---|
| Still1 | arm out, as still as possible | 0.006 / 0.025 | 0.00023 / 0.00046 |
| Still2 | a little more motion | 0.018 / 0.061 | 0.00039 / 0.00155 |
| Still3_perc | ghosting Claire's small movements | 0.078 / 0.24 | 0.0010 / 0.0052 |
| Writing1 | smooth writing, large | 0.22 / 0.35 | 0.015 / 0.025 |
| Writing2 | aggressive writing | 0.54 / 0.95 | 0.027 / 0.048 |

  Still1 → Still2 is ×3 in energy and ×1.7 in rotation; still → ordinary motion is ×40–100. A fixed threshold cannot serve both the "how little" contest and the tip-over; the log-domain adaptive measure in §4 does.

## 3. Findings

### A — Physics
1. At C6 a singer's f0 is above F1 of every vowel (/a/ ≈ 850 Hz, /u/ ≈ 370, /i/ ≈ 310); sopranos tune the first resonance to f0 up to C6–D6 — Garnier et al. 2010, https://www.phys.unsw.edu.au/jw/reprints/highsoprano.pdf; Vos et al., https://pure.royalholloway.ac.uk/ws/files/28187915/VosEtAl_FormTuningJVoicePURE.pdf.
2. A closed-mouth hum has no open-vowel formants: nasal F1 ≈ 250–300 Hz, an antiformant between 750 and 1250 Hz, strong damping; at C6 the hum is mostly source harmonics under a soft low-pass *(inferred from snippets; the OGI tutorial page confirms only F1 ≈ 250 Hz)*.
3. Classical vibrato: 4.5–6.5 Hz, 50–120 cents peak-to-peak; below 20 cents reads as straight tone, above 150 as excessive; "wobble" is < 4 Hz and wide — https://www.voicescience.org/lexicon/vibrato/.
4. Slow f0 modulation taxonomy: wow 0.2–3 Hz, tremor 4–7 Hz, flutter 8–20 Hz; tremor differs from vibrato by cycle-to-cycle jitter and shimmer (irregular, not sinusoidal) — https://arxiv.org/pdf/1909.03335.
5. Infant cries (n = 200, Praat): jitter 1.74 % (SD 0.91), shimmer 8.4 % (SD 2.9), HNR 12.4 dB, mean f0 601 Hz; high-risk cries jitter 2.07 %, shimmer 10 %; a steady adult vowel has jitter < 0.5–1 % and shimmer < 3–5 % *(adult figures inferred)* — https://www.ijhsr.org/IJHSR_Vol.9_Issue.12_Dec2019/9.pdf. Rule: a whimper ≈ 2× the jitter and 2–3× the shimmer of a steady voice.
6. Cry contour vocabulary: hyperphonation = an abrupt shift of f0 above ~1000 Hz (reaching 1500–2000 Hz) with voice breaks; glide = a rapid short f0 change; cry arcs are > 300 ms with ≥ 2 semitones of modulation; 60 % of cries are multi-arc — https://arxiv.org/pdf/2310.08338; https://pmc.ncbi.nlm.nih.gov/articles/PMC10273904/.
7. Balinese ombak is a **fixed Hz difference**, not fixed cents: gender wayang 3–6 Hz, semar pagulingan 6–8, gong kebyar 7–10, angklung 6–10; the same Hz offset is kept in every register — https://swarasanti.nl/upload/doc/Tuning%20of%20balinese%20gamelan%20instruments.pdf (Table 1); Vitale & Sethares 2021 (typical ≈ 8 Hz over 49 gamelans). At C6, 8 Hz = 13.2 cents, 3 Hz = 5 cents (spot-checked arithmetic).
8. Measured gong partials: bronze gong with boss 1, 2.00, 2.99, 3.72, 3.99, 4.71, 5.70 — McLachlan 1997, https://www.acoustics.asn.au/journal/1997/1997_25_3_McLachlan.pdf (Table I); a Sunda bonang kettle 1, 2.01, 4.05, 4.40, 4.55, 4.75 — Schneider & Frieler, https://www.mu-on.org/frieler/docs/schneider_frieler_inharmsound_final.pdf (Table 3). The gong ageng carries a slow AM/FM of a few Hz on many partials — https://en.wikipedia.org/wiki/Gong_ageng.
9. Choir pitch scatter: listeners tolerate an SD of 14 cents in a unison section and prefer 0; measured sections run 20–55 cents; flutter (≤ 20 cents, > 5 Hz) and wow interfere across voices to make the chorus effect — Ternström, KTH-QPSR review (spot-checked: "listeners would tolerate a standard deviation in F0 of 14 cents"); Jers & Ternström, https://www.speech.kth.se/qpsr/2005/2005_47_1_001-006.pdf.
10. Roughness follows beat rate against the critical band (≈ 160 Hz at C6): beating stays smooth to ~15 Hz (≈ 25 cents at C6) and is roughest near 30–40 Hz (≈ 50–65 cents) — Plomp & Levelt via https://arxiv.org/pdf/2510.14159; Sethares, *Tuning Timbre Spectrum Scale* (roughness peaks near a quarter of the critical bandwidth).

Disagreements: vibrato extent (±25–60 cents in voice science vs 70–90 cents in synth choirs); where roughness peaks (20–30 Hz vs 32 Hz vs carrier-dependent) — the design keeps a quarter tone as a *transit*, never a resting place. So for the patch: fused hum from a few voices within ±13 cents; a whimper = tremor with jitter, not sinusoidal vibrato; departures beyond ~25 cents are tension, just ratios are resolution; add an inharmonic gong layer only with motion.

### B — Synthesis prior art
1. Keep the first formant *above* the note at high pitch: a choir synth keeps F1 ≥ 1.15 × f0 so high notes keep a vowel — https://github.com/BertCalm/SnipSnap/pull/343 (VOX).
2. Above ~1 kHz vowels lose identity; sopranos tune R1 (and above C6, R2) to f0 — so a single formant peak near f0 is the natural timbre at 1046 Hz — Vos et al. (as A1).
3. Csound soprano formant table: /a/ 800/1150/2900/3900/4950 Hz, amps 0/−6/−32/−20/−50 dB, bandwidths 80/90/120/130/140 — https://csound.com/docs/manual/MiscFormants.html; the SC tutorial uses the same row and a quarter-tone vibrato with a 2.5 s onset — https://composerprogrammer.com/teaching/supercollider/sctutorial/12.2%20Singing%20Voice%20Synthesis.html.
4. `Formant.ar` reads its frequencies at control rate and needs `bwfreq ≥ fundfreq` (≈ 1 kHz bandwidth at C6): useless for a narrow formant here; use BPF/Resonz on a harmonic source — https://doc.sccode.org/Classes/Formant.html.
5. Choir recipe numbers: ±10–12 cents per-voice detune, random-phase LFOs; 7 voices with entries staggered ≤ 60 ms and a slow random wobble — https://sccode.org/1-4YS; the VOX PR above.
6. Ombak reproduced as a constant Hz offset (5 Hz ≈ 8 cents at C6, 34 cents at C4) — https://en.wikipedia.org/wiki/Ombak (qualitative).
7. Just targets on C6 = 1046.5 Hz: 5/4 → 1308 Hz (386 c), 11/8 → 1439 (551 c), 3/2 → 1570 (702 c), 7/4 → 1831 (969 c), quarter tone → 1077 (50 c) (calculated).
8. Reverb cost measured on this Mac, 8 mono-summed copies, 48 kHz: FreeVerb 2.9 %, GVerb 4.8 %, NHHall 7–10 %, Greyhole 23 %, JPverb 26 % (scsynth baseline 0.9 %) — scratchpad `bench.scd`. Per copy: NHHall ≈ 1.2 %, JPverb ≈ 3.3 % at t60 8.
9. `JPverb.ar(in, t60, damp, size, earlyDiff, modDepth, modFreq, low, mid, high, lowcut, highcut)`; size < 1 sounds metallic; NHHall's `modRate`/`modDepth` default 0.2/0.3 and `rt60 = inf` freezes — local `.schelp` files.
10. No instrument in the literature stays pure at rest and destabilises with tiny motion; Lucier's *Music for Solo Performer* (motionless performer, alpha waves) and Tanaka's "restraint" are the precedents — https://www.straebel.com/files/Straebel-Thoben%202014_Lucier%20M4SP.pdf; http://econtact.ca/14_2/tanaka_personalsurvey.html.

Disagreements: JPverb CPU (web reports 9–66 % vs 3.3 % measured here); Formant.ar's rate. So for the patch: harmonic source through one BPF at ≈ 1.25 × f0 per voice; 4 voices with static ±3–8 cent detune and random-phase 5–6 Hz vibrato whose depth follows unrest; a per-copy NHHall halo; the whimper as a random walk plus short glide bursts (no source gives rates — tuned by ear).

### C — Musical world
1. Ombak tuners keep ≈ 8 Hz across the whole gamelan (6–10 Hz measured); at C6 that is ≈ 13 cents — Vitale & Sethares 2021, https://iftawm.org/journal/oldsite/articles/2021b/Vitale_Sethares_AAWM_Vol_9_2.pdf.
2. Each instrument sits within 1 Hz of its group (pengumbang low, pengisep high), the groups 7–10 Hz apart — so the pair reads as one shimmering note, not a cluster (same source).
3. Slendro is roughly five stretched equal steps (206–268 cents measured; octaves 1204–1212) — https://www.microtonaltheory.com/microtonal-ethnography/indonesian-gamelan; Sethares *TTSS*. Pelog approximates a 9-tone equal division (~133-cent steps) — https://en.wikipedia.org/wiki/Pelog.
4. Harmonic-series offsets from equal temperament: partial 7 −31 cents, 11 −49, 13 +41; 5/4 is 14 cents flat of the tempered third; Haas builds "Klangspaltung" from near-unisons only 17 cents apart — Hasegawa 2015, https://hasegawa.research.mcgill.ca/pdf/Hasegawa-Clashing_Harmonic_Systems_Haas_2015.pdf.
5. Scelsi's single-note grammar: establish the focal pitch, depart (a semitone, a microtone, a quarter tone off the octave), return — Pocknee's analysis of Quartet No. 4, https://davidpocknee.ricercata.org/writing/031_analysis_scelsi-quartet/david-pocknee_analysis_giacinto-scelsi-quartet-4.pdf. Radulescu energises a drone with very high unstable partials that flicker and collapse back — https://eprints.whiterose.ac.uk/id/eprint/128000/1/Radulescu_the_other_spectralist_020218.pdf.
6. C6 is the top of a treble voice (A3–F5 typical; some reach C6) and infant cries mostly sit ≤ 600 Hz, reaching 1–2 kHz only by an abrupt hyperphonation jump — https://en.wikipedia.org/wiki/Boy_soprano; Meghashree & Nataraja 2019. The C6 region *is* the break.
7. Xenakis *Nuits*: twelve voices in keening quarter-tone plaints, "absolutely without vibrato" so the quarter tones read — https://www.hyperion-records.co.uk/dw.asp?dc=W4860_GBAJY9798002.
8. A well-tuned grand is stretched ~+20…+30 cents at C8 and ~0 at A4, so its C6 is likely +8…+15 cents sharp — https://frequencydetector.com/piano-stretch-tuning-calculator/ *(C6 value inferred)*.
9. Beat rates at C6: ±5/10/15 cents ≈ 3/6/9 Hz (smooth), ±22–27 ≈ 13–16 Hz (fast shimmer), ±31–39 ≈ 19–24 Hz (tense edge), ±50 ≈ 31 Hz (roughness peak) — Sethares *TTSS* (Plomp–Levelt), arithmetic mine.

Disagreements: ombak by genre (5 vs 7 vs 7–10 Hz for kebyar); slendro step size; roughness peak. So for the patch, the **ordered departure set in cents** (paste-ready): rest 0 ± ombak (5–13); shimmer `[22, 27]`; tense `[31, 39, 50]`; just above `[386, 551, 702, 969]` (5/4 sweet, 11/8 floating, 3/2 locked, 7/4 plaintive); just below `[-112, -204, -386, -498]`. Against the piano only 3/2 lands on a key. Keep the resting spread within ±14 cents; keep the piano safe by never *resting* at ±31…50.

### D — Gesture and mapping
1. Postural hand tremor is a mechanical-resonance peak near 8 Hz (7–11 Hz) that rises 2–5× during slow voluntary movement — Lakie et al., https://pmc.ncbi.nlm.nih.gov/articles/PMC3424765/.
2. Fatigue raises tremor in the 8–14 Hz band over a hold — https://pmc.ncbi.nlm.nih.gov/articles/PMC12231529/; mental load raised tremor SD 29 % and the peak 79 % with no frequency change — https://pmc.ncbi.nlm.nih.gov/articles/PMC9613750/. Trying harder does not lower the floor: the floor must creep up and never punish effort.
3. 100 Hz sampling is adequate for tremor (≥ 50 Hz required) — https://tremorjournal.org/articles/10.5334/tohm.115; at the 33 Hz tick the 4–12 Hz band is seen only as an energy envelope.
4. At Still1's jitter (0.025 m/s² at 8 Hz) the displacement is ≈ 10 µm: Still1 is at the sensor/tremor floor; Still1 → Still2 is inside tremor-level variability, Still → Writing is real motion *(arithmetic, inferred)*.
5. Latency: 10 ms for percussive control (Wessel & Wright, https://arxiv.org/pdf/2010.01570), 20–30 ms for continuous gesture (McPherson, https://www.nime.org/proceedings/2016/nime2016_paper0005.pdf): a 30 ms tick is fine for a continuous hum.
6. Hunt & Wanderley: one-to-one mappings plateau; players prefer energy-injecting many-to-many maps that need effort — https://www.nime.org/proceedings/2002/nime2002_088.pdf. Tanaka: "restraint" as a mode of play — https://research.gold.ac.uk/19674/1/LEON_a_01018-Tanaka-web.pdf.
7. FM detection on a 1 kHz carrier is best at slow rates (2 Hz better than 10–20 Hz); a rule of thumb of 3–8 cents peak deviation at 2 Hz *(inferred)* — Moore & Sek, https://www.repository.cam.ac.uk/bitstreams/bda5af69-1301-4980-bf93-cc74e0fdfa5b/download.
8. Noise-floor tracking by minimum statistics: the minimum of a smoothed estimate over a window of a couple of seconds, with a bias — Martin 2001 *(search description only)*.

So for the patch: one **unrest** value `x = log2(motion / floor) − dead zone` from a fast-attack, slow-release motion follower over a running-minimum floor that creeps upward (fatigue) and falls at once (a stiller performer gets finer); a 30 ms attack, 1.5–3 s release for the settle; a **stillness credit** that fills over ~40 s below x = 1 and leaks over ~8 s above x = 2, driving the bloom; the wobble LFO at 2–5 Hz where FM is most audible, from ~3 cents at the floor to 50–70 at a quarter tone.

### E — SuperCollider practice (local sources, SC 3.13.0, sc3-plugins)
1. `Blip.ar(freq, numharm = 200, mul, add)` — nearly free (0.12 % for 16 copies) and safe to modulate `numharm` (`FSinOsc.sc:112`, spot-checked).
2. `BPF.ar(in, freq = 440, rq = 1, mul, add)` (`Filter.sc:185`, spot-checked); `Resonz` has constant 0 dB gain; neither help gives a minimum rq — rq ≥ 0.1 is the tested rule.
3. `Formant.ar` needs `bwfreq ≥ fundfreq` (control-rate only) and `Formlet` cancels when attack = decay and is 4× the cost — both rejected.
4. `NHHall.ar(in[2], rt60 = 1, stereo = 0.5, lowFreq = 200, lowRatio = 0.5, hiFreq = 4000, hiRatio = 0.5, earlyDiffusion = 0.5, lateDiffusion = 0.5, modRate = 0.2, modDepth = 0.3)` — **throws unless `in` is a 2-array**; wet only (`NHUGens/NHHall.sc:1-25`, spot-checked).
5. Measured 16 copies of 4 × (VarSaw + 3 BPF) + Limiter: 2.06 % dry; + NHHall 4.96 %; + JPverb 11.98 %; + Greyhole 8.87 %; + GVerb 3.36 % (GVerb zippers on parameter change — unusable live) — scratchpad `cpu.scd`.
6. `VarLag.kr(in, time, curvature, warp = 5, start)` restarts its full time on every change; `Lag3.kr(in, lagTime)` is cheaper; `LagUD.kr(in, lagTimeU, lagTimeD)` for asymmetric settles (`Filter.sc:89-140`, spot-checked).
7. `LFNoise1/2.kr(freq)`; `LFDNoise3.kr(freq)` (class inherits `LFNoise0`) (`Noise.sc:206-231`).
8. `Limiter.ar(in, level = 1, dur = 0.01)` (a `Normalizer` subclass; delay 2 × dur) (`Compander.sc:33-40`, spot-checked); `LeakDC.ar(in, coef = 0.995)`; `.lagud(up, down)`, `.lincurve(inMin, inMax, outMin, outMax, curve, clip)` argument orders confirmed (`UGen.sc`).
9. `\name.tr(0)` trigger controls work with `.set` from the tick (corpus `ALTOSYNTH.sc:58`).
10. `Env.asr(0.02, 1, 0.15)` with `doneAction: Done.freeSelf` multiplied in **after** the reverb cuts the tail with the synth.

So for the patch: per voice `SinOsc` core + `Blip` through one `BPF` at 1.25 × f0 + four partial `SinOsc`s whose ratios morph harmonic → gong; `NHHall` per copy; `LeakDC` → `.tanh` → `Limiter` → amp → env. Estimated < 0.6 % per copy.

### F — Steph's corpus (`patching/corpus/<branch>/personalities/<file>:<line>`)
1. No formant, vowel or motion-driven detune anywhere in 459 personalities; `JPverb` appears only commented out (`Airsticks-RPI/personalities/mel5.sc:27`). The hum and the waver are new work.
2. Whisperer's voice skeleton: `SinOsc.ar(freq, 0, 0.6) + Saw.ar(freq * 1.005, 0.15)` → `RLPF.ar(sig, cutoff.lag(1.5), 0.4)` → `amp.lagud(lagAttack, lagRelease)` (`AirConcert/personalities/cotf_whisperer1.sc:46-48`); staggered per-voice lags 0.2/0.5 … 0.09/4 s (`:156-158`).
3. Stillness as the fullest state: `{ true } { \high }` inverted tier (`cotf_whisperer1.sc:142`) — but its `accelMassFiltered` floor is gravity-blind and misfires on a tilted rest (F4); re-host on the template's gravity-free `energy`.
4. Fuzzy-OR of acceleration and rotation, `a + r - (a * r)` (`AirConcert/personalities/STRINGCHORD.sc:73`); rotation sensitivity 0.05 (`AirConcert/personalities/WindVoice.sc:238`) — rotation rate is the finer channel for "how little".
5. Hard-zero below a threshold, `if (in < thresh) { 0 } {` (`cotf_whisperer1.sc:130`) — "a curve's bottom is not silence" scar.
6. Detune pairs `[1.003, 1.008]` (`AirConcert/personalities/ALTOSYNTH.sc:61`), `[1, 1.003]` (`AirConcert/personalities/SOPRANOVOICE.sc:60`); slow partial drift `LFNoise2.kr(0.1).range(0.999, 1.001)` (`Airsticks-RPI/personalities/footGong.sc:81`); glide `freq.lag(0.9)` (`SOPRANOVOICE.sc:56`); a wander that settles over 15 s (`AirConcert/personalities/cotf_test1.sc:275`).
7. Gong partial table `[1, 1.36, 1.97, 2.43, 3.24, 4.16, …]` with each partial as three sines at ×0.999/1/1.001 and a slow AM "shimmer" (`footGong.sc:34, :62, :87, :96`).
8. In-personality reverbs are light: `FreeVerb2.ar(sig[0], sig[1], verbMix, verbRoom, verbDamp)` (`Airsticks-RPI/personalities/arialMelody.sc:321`), `Greyhole.ar(sig, 0.2, 0.3, 0.4, 0.2, 0.3)` blended 0.2 (`Airsticks-RPI/personalities/drone1.sc:21-22`); no CPU comment anywhere.
9. Warnings: `\whisperVoice`, `\simple`, `\largeGong` unprefixed; whisperer depends on `ctx.voicePool` (`:258`) and a 2.5 s `~deinit` wait (`:96`); `BMoog` in ALTOSYNTH — none lifted.

So for the patch: the template `energy` + `rrateMass` as the motion measure (F4 logic, gravity-free), the inverted-tier idea (F3) as "stillness is the fused state", whisperer's lagged level (F2) for the settle, footGong's inharmonic partials (F7) as the morph target, the corpus detune pairs (F6) for the resting spread.

## 4. Design

- **Technique** — a **four-voice formant-coloured harmonic hum** per copy: each voice is a sine core plus a band-limited pulse (`Blip`) through one band-pass at 1.25 × f0 (the R1-to-f0 tuning of A1/B1, kept above the note per B1), plus four partials whose ratios morph from harmonic `[2, 3, 4, 5]` toward the bronze-gong set `[2.00, 2.99, 3.72, 4.71]` (A8) with motion, plus an octave-below partial that only the bloom opens; a per-copy **NHHall** halo. It beats additive-only (no formant, no body), a sampled choir (the brief says all synth; samples cannot detune into just ratios cleanly), and JPverb (3× the cost of NHHall for eight copies, E5).
- **Idiom** — `patterns.md` §1 long-lived synth reshaped every tick; §6 energy tier (for the departure tier); §7 stillness reveal (the bloom); §10 params; §11/§12 exit.
- **Parameters**:

| parameter | value | from finding |
|---|---|---|
| reference | C6 = MIDI 84 (register low/high ± 12) | brief; C8 |
| resting per-voice detune | [−8, −3, +3, +8] cents | A9 (SD ≤ 14), B5, F6 |
| ombak per wrist | ZL −3, ZR −1, CL +1, CR +3 Hz (slot 9: 0) | A7, C1–C2 (fixed Hz; ≤ 6 Hz between any pair) |
| rest flutter | 2 cents at 5–6 Hz with 15 % rate jitter | A3, A9 (≤ 20 cents, > 5 Hz) |
| rest wow | 3 cents at 0.3 Hz per voice | A4 (0.2–3 Hz) |
| whimper tremor depth | 2 → 25 cents over unrest 0 → 4 (iteration 5; the whole excursion is clipped at ±60 c) | A3, A5 (2× jitter) |
| tremor rate | 4.5 + 0.4·x Hz | A4 (tremor 4–7 Hz) |
| shimmer (amp jitter) | 2 % → 12 % | A5 (3 % → 8–10 %) |
| whimper glide | +20…+68 cents, 60 ms up / 350 ms back, refractory 0.35–1.2 s | A6 (glide, arcs > 300 ms), C6 (the break is upward) |
| departure sets | shimmer [22, 27]; tense [31, 39, 50]; far [±45, ±50] (a quarter tone at most since iteration 5; was just seconds in iteration 4, fifths/sevenths before); whole excursion clipped at ±60 c | C4, C9; Ciaran 2026-09-29 |
| tip-over glide / return | 0.25 s toward the target, 3.5 s back | C5 (depart–return), D5 |
| gong morph | 0 → 1 over motion 0.05 → 1.0, lag 0.8 s | A8, F7 |
| formant | BPF at 1.25 × f0, rq 0.8, then LPF at 4 × f0, pulse at 0.3 with 2–7 harmonics (iteration 4: rounder); singer band 2800 Hz rq 0.3 with bloom | A1, B1, B3 |
| reverb | NHHall rt60 6 s, stereo 0.6, hiRatio 0.35, modRate 0.2, modDepth 0.3; wet from param | B8–B9, E4–E5 |
| rest level | −26 dBFS peak per copy, +3 dB with full bloom; −12 dBFS shaken hard | profile level plan |
| unrest floor | running min of the motion follower, creep τ ≈ 20 s, clamp [0.003, 0.3], dead zone 0.5 octave | D2, D8 |
| motion follower | attack 1 tick (0.7), release τ ≈ 0.5 s (0.06) | D5 |
| stillness credit | +1 per 18 s below x = 1.5, −1 per 16 s above x = 2.5 (iteration 4: earlier, likelier) | D6, patterns §7 |

- **Pitch world and time** — one reference note per scene (`register`: low C5, mid C6, high C7). Every copy holds it; the four copies differ only by their ombak Hz, so together they beat at ≤ 6 Hz (A7/C1: the gamelan unison). Departures are chosen from an ordered set by the unrest tier and glide there in 0.25 s and back in 3.5 s (Scelsi's depart–return, C5). `pitchset` picks the departure family: `harmonics` (just ratios, default), `quarter` (`[50, −50, 100, −100, 150]`, Xenakis-plain), `gamelan` (slendro-ish `[240, 480, −240, −480]`, C3). Time is continuous — no clock, no Pdef; the whimper's refractory is the only event rhythm. Since iteration 4 the whole excursion stays within a tone either side: the far tier lands on just seconds, never a fifth or a seventh.
- **Mapping** — performer terms first:

| gesture (piano / drum terms) | model source | → parameter | in range | out range | curve / smoothing | why |
|---|---|---|---|---|---|---|
| arm held as still as a human can (Still1) | `mot` ≈ floor, x ≈ 0 | fused hum, 2-cent flutter, 3-cent wow, ombak beat | x 0–0.3 | detune 0, tremor 2 c | — | the designed rest: a note, not silence (profile) |
| breathing, a heartbeat, a finger twitch (Still2) | x 0.3–1 | tremor depth, shimmer, rate | x 0–1 | 2 → 17 c, 2 → 5 % | linear on x, 30 ms up / 2 s down in the synth | the "how little" contest: audible but gentle |
| a hand that starts to drift or ghost a stroke (Still3) | x 1–2, tilt sign | shimmer-tier departure `[22, 27]` + whimper glides | x 1–2 | ±22…27 c, glides 20–40 c | tier with hysteresis; glide 0.25 s, return 3.5 s | "about to tip" — fast beats, still smooth (C9) |
| a slow reach toward the keys, a soft preparatory lift of the beater | x 2–3.2 | tense tier `[31, 39, 50]` | x 2–3.2 | ±31…50 c | as above | the edge of roughness; never rests here |
| a real gesture: a rolled chord, a stroke, writing | x > 3.2 or `mot` > 0.35 | just-harmonic tier (random pick, 1.5 s refractory), gong morph, level up | mot 0.05–1.2 | ratio from the set; morph 0 → 1; −26 → −12 dBFS | lincurve −2 on level; morph lag 0.8 s | "falls off the precipice into a beautiful harmonic" |
| which way the hand leans | `gyroYFiltered` sign | sign of small-tier departures | −1…1 | up / down | 0.5 s lag | tilt is orientation, not motion: only the direction, never the amount |
| twenty to forty seconds of true stillness | credit 0 → 1 | bloom: octave-below partial, singer formant band, +0.2 wet, +3 dB | 40 s | 0 → 1 | ease-in; leaks over 8 s on motion | the reveal (patterns §7, D6): stillness rewarded, never punished |

  Model fields: `mot = energy + 40·rrateMass` where `energy` is the template's gravity-free follower (so AirKit sticks with gravity and the Glimmer stick without behave alike) and `rrateMass` is radians per packet clipped at 0.2; `x = (log2(mot / floor) − 0.5).clip(0, 6)`.
- **At rest / stillness** — the fused hum at −26 dBFS per copy: four voices within ±8 cents, flutter, wow, the ombak beat between wrists, formant on the note. The reveal: after ~40 s under x = 1 the hum blooms (C5 under it, the 2.8 kHz singer band opens, the halo widens by 0.2 and the level rises 3 dB), and it fades back over ~8 s when the arm moves again.
- **Two-hand** — n/a (four independent copies; the ombak offsets make the unison from the slot index alone).
- **Standby and exit** — nothing accumulates: `mot`, `floor`, `credit` are all clamped; no events queue; the reverb is fed only by the held hum, which is quiet at rest and at level 0 while unheard the synth still runs (fine: NHHall on a −26 dBFS input arrives already "warm", which is the point of a crossfade into a hum). Release 0.15 s after the reverb; `~deinit` gates the synth and nils the ref.
- **Level and CPU** — rest −26 dBFS peak (four copies ≤ −14), gentle sway −22…−18, hard shake −12; ceiling `Limiter.ar(…, 0.5)` after `.tanh`. Estimated ≈ 60 UGens + NHHall per copy, ≈ 0.5 % each, ≈ 4 % for eight.
- **Samples** — none.

## 5. Params

| key | type / range | default | what it changes audibly |
|---|---|---|---|
| register | low \| mid \| high | mid | the held note: C5 / C6 / C7 |
| pitchset | harmonics \| quarter \| gamelan | harmonics | where the tip-over lands: just ratios, quarter tones, slendro-ish steps |
| brightness | 0–1 | 0.5 | how many harmonics the pulse carries and how loud the upper partials are |
| wet | 0–1 | 0.5 | the halo: NHHall mix (bloom adds up to 0.2) |

Header line: `params: register (low|mid|high, mid), pitchset (harmonics|quarter|gamelan, harmonics), brightness (0–1, 0.5), wet (0–1, 0.5)`.

## 6. Hand-off

- **What it is** — a high choral hum that all four wrists hold on one note; the stiller the arm, the purer and (slowly) fuller it gets, and the slightest movement makes it waver, whimper and slide toward a harmonic before it settles back.
- **How to play it** — hold the arm out and try not to move: that is the whole technique. A breath or a heartbeat is enough to hear the tremor. A slow drift or a ghosted stroke tips the note over into a shimmer; a real gesture (a rolled chord, a beater lift, writing in the air) sends it to a harmonic and thickens it with gong colour; then be still again and it comes home over three or four seconds.
- **Listen for** — at rest: a fused, slightly beating hum with a faint flutter; gently: a whimper (small upward sobs, more tremor); hard: the note leaves for a fifth, a seventh, an eleventh, with a gong ring under it, at −12 dBFS; the reveal: after half a minute of true stillness the hum blooms an octave below and opens its halo.
- **Scene params worth trying** — `register=low` (C5: darker, the piano's own range); `pitchset=quarter` (the tip-over lands on quarter tones only, plainer and more Xenakis); `brightness=0.8` (glassier); `wet=0.8` (a wider halo).
- **Checks** — compile: `COS_Precipice.sc.tmp: parses`; lint: 0 errors, 0 warnings once in the roster (roster: `silence, COS_Template, COS_Precipice, silence`); audition (synthetic, first version, `--rest-max -18`):

```
rest ceiling -18.0 dBFS (settled peak of rest/still/settle)
phase  | seconds | peak dBFS | rms dBFS | verdict
-------|---------|-----------|----------|-------------------
rest   | 2       | -27.8     | -33.4    | ok (settled -27.8)
tilt   | 3       | -21.3     | -28.3    | ok
sway   | 4       | -20.4     | -27.4    | ok
shake  | 3       | -18.2     | -25.2    | ok
strike | 3.5     | -18.8     | -24.7    | ok
still  | 4       | -21.0     | -29.4    | ok (settled -24.4)
settle | 1.5     | -28.1     | -34.3    | ok (settled -28.2)
server cpu (max) 4.2 %
AUDITION PASS (22.1 s)
```

  The synthetic shake reaches only −18 dBFS because its motion energy is below a real gesture's (Writing1 emulates to −11, see the iteration log); the tilt phase rises to −21 because the gravity follower reads a 40° rotation of the gravity vector over 2 s as motion (only on gravity-including sticks; the Glimmer stick sends none). Take auditions (final version):

```
Still2 (27.2 s)          Writing1 (30.8 s)        Still1 (26.0 s, iteration 2)
0–5 s   -17.1 / -25.4    0–5 s   -12.3 / -19.7    0–5 s   -16.9 / -25.5
5–10    -22.4 / -30.0    5–10    -12.3 / -19.7    5–10    -25.4 / -31.3
10–15   -23.2 / -31.0    10–15   -11.7 / -19.7    10–15   -25.5 / -31.7
15–20   -13.6 / -21.7    15–20   -12.4 / -19.1    15–20   -25.9 / -30.2
20–25   -21.4 / -28.7    20–25   -12.0 / -19.8    20–25   -24.1 / -29.1
25–end  -23.4 / -30.2    25–30   -11.8 / -20.0    25–end  -24.9 / -31.3
server cpu (max) 4.0 %   server cpu (max) 3.9 %   server cpu (max) 4.1 %
AUDITION PASS            AUDITION PASS            AUDITION PASS
```
(peak / rms dBFS per 5 s window.) Final synthetic run: rest −28.5, tilt −20.6, sway −12.9, shake −18.6, strike −19.1, still −21.5 (settled −23.8), settle −26.9; cpu 4.2 %; AUDITION PASS. The first window of every take carries the arm settling after the record button; Still2's 15–20 s window is its one real twitch, which tips the note over (on-brief, but judge it by ear).; samples: none.
- **Open questions** — Should the reference be the piano's actual C6 (stretched sharp) or ET C6? Is −26 dBFS per copy (≈ −14 for four) the right rest level in the room? Does the whimper glide want to be rarer? Is 40 s the right wait for the bloom, or should it be longer for the intro's length?

## 7. Sources

See §3 — every URL and `file:line` is given inline with its finding. Code borrowed: none pasted; techniques only (licences n/a). Local measurements: scratchpad `bench.scd` (track B reverb CPU), `cpu.scd` (track E UGen CPU); take statistics computed in-session from `takes/Still1…Writing2.take.jsonl`.

## 8. Iteration log

2026-09-29 — first version written from the research above; not yet heard by Ciaran.
2026-09-29 — **heard by Ciaran on the blank stick (X0 as ZL, audition slot)**: "sounding good"; the sob and flutter are right. Notes: (1) remove the wild glides to other notes — a tone either side at most; (2) the bloom should come earlier and be likelier, they may never be completely still; (3) the hold is slightly square-wave / lead-synth — round it without changing much. Iteration 4: far tier = just seconds [±112, ±151, ±182, ±204] with a ±230 c clip on the whole excursion, tremor cap 40 c, sob 20–68 c; credit fills in 18 s under x < 1.5 and leaks over 16 s above 2.5; pulse at 0.3 (was 0.5) with 2–7 harmonics (was 3–12), BPF rq 0.8 and an LPF at 4 × f0, odd partials halved, partials drift ±0.1 %, sine core 0.6.
2026-09-29 — Ciaran on iteration 4: "much better"; narrow to a quarter tone; is it distorting? Iteration 5: the output shaper ran at 1.5× into `tanh` and *was* saturating on the hold (real distortion, and probably part of the earlier lead-synth edge) — now 0.35× (near-linear) with the Limiter as the only ceiling, level curve re-set pre-shaper to −17…−5 dB (measured rest −25.4, Writing1 peaks −10…−7 at −2, trimmed to −5); far tier ±45/50 c, whole excursion clipped at ±60 c, tremor cap 25 c, sob 15–45 c; `pitchset=gamelan` now ±40. Admin shows slot 9's meter on the auditioning wrist's strip (`AUD −xx dB`) so an audition is no longer blind. Audition PASS (synthetic rest −25.4, shake −15.8; Writing1 −10…−7 before the −3 dB trim).
2026-09-29 — offline emulation of the tick meter on the five takes (after 3 s warm-up): Still1 x p50 0.00 / p90 0.82, tiers rest 91 % shimmer 9 %, tremor 2–7 cents, credit 0.56 after 26 s; Still2 x p50 0.34 / p90 2.06, tiers 66/17/12/5 %, tremor 4–18 c; Still3_perc tiers 43/22/1/33 %; Writing1 and Writing2 100 % far tier at −11 dB (the floor creeps up under sustained motion, so tremor thins to 12–23 c while the harmonic tier and gong morph carry the gesture). Iteration 1 (before Ciaran heard it): the far tier now needs `mot > 0.6` (a single Still2 twitch reached 0.93 and could pick a harmonic) and the level lag is 0.25 s up / 1 s down (was 0.05 / 0.8) so one twitch cannot jump the level to −12 dBFS.
2026-09-29 — take auditions (iteration 1): Still1 −25…−26 dBFS steady after its first window; Still2 −23…−17 (wavers, one twitch window); Writing1 −12 every window (the level plan's hard end) but **FAIL: not silent within 1 s of the unload** — under investigation (the two still takes unloaded cleanly). Iteration 2: the gravity follower is seeded from the first packet (`grav = nil` until the first tick) so a load never reads a false burst on a gravity-free stick; synthetic run PASS again. Still1's first window still peaks −16.9, so that burst is in the take (the arm settling after the record button), not the meter. Iteration 3: `whimper` was a plain control used as an EnvGen gate, so the sob fired once per load and never again — now `t_whimper` (a trigger control); the per-packet rotation term is clipped at 0.05 rad (Writing2 p90 0.048) so a synthetic orientation teleport or a WiFi packet gap cannot read as a violent twist (the synthetic sway had peaked −12 from the tilt→sway boundary).
2026-09-29 — the Writing1 "not silent after unloading" failure reproduced with a clean engine log (`deinit : COS_Precipice` then `init : silence`, no errors). Cause: the engine's audition meter is `SendPeakRMS.kr(sig, 10, 3, …)` — a **3 s peakLag** (a VU-style display decay), so the reported *peak* cannot fall 28 dB within the tool's 1 s window however fast the synth releases; the still takes passed only because they had 15 dB to fall. The synth itself releases in 0.15 s after the reverb (env is the last multiply). Fix in the tool, not the patch: `patch-audition.ts` now judges the post-unload silence on the meter's **rms** (per reply window, no lag) at the same −40 dBFS / 1 s rule; its test models both peak and rms staying up; `patching/tools/README.md` and `engine.md` §3 note the meter lag.
2026-09-29 — Ciaran on iteration 5: "sounding good, let's lock this for now". Locked at AirKit 3339afc. Still open: piano-true vs ET C6; rest level in the room with four copies; whether the sob wants to be rarer.
