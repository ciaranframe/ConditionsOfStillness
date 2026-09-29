# COS_Precipice2 — "the next stage of Precipice: slightly more creepy, unsettled and reactive, building tension; wails and stretched screams; a bounded Ligeti-ish cluster"

Date: 2026-09-29 · Asked by: Ciaran (in session) · Scene(s): the scene after the intro — `patching/context/` still holds only its README; the brief and the Precipice note are the context · Status: **heard by Ciaran and locked** (2026-09-29, iteration 3, AirKit e652afb) — AUDITION PASS on synthetic, Writing1, Still2
Reusable findings: a per-copy **tension state** (rises with sustained unrest, freezes while moving, leaks with stillness, caps itself after a held peak) is the piece's second meter after unrest (§4); the **cry cue table** for `wails` (§2) is the way to play a long file of separate events; at C6 a *narrow* beating cluster (50–100 c) is the dread band and a wide mass is awe (§3C) — "bounded" and "creepy" point the same way.

## 1. Brief

"make Precipice2 which would be the next 'stage' or transition of this patch. It should be based on this patch so don't make huge dramatic changes, but I still want you to fully use the skill and research etc. - the big change here is that it needs to be slightly more 'creepy'. I have here some extra audio samples that you might like to take advantage of in downloads (Discrete_wails_and_screams, Low_stretched_male_scream, High_stretched_female_scream) to create a more unsettled and more reactive environment that builds tension. You might also like to experiment a la Ligeti strings sort of thing, but not too much, keep it bounded."

Read like a composer. The hum is the same hum: same note, same stillness meter, same sob and flutter and bloom (COS_Precipice, locked at AirKit 3339afc). What changes is the *room around it*: an environment that is never quite at rest, that answers a twitch with something distant and human, that grows more present the longer the performers fail to be still, and that has a ceiling. The referents are the ones the brief names — human wails, time-stretched screams, Ligeti's string clusters — and the research adds the mechanism: **roughness** (amplitude modulation at 30–150 Hz) is what makes a voice a scream, *chaos* (fast f0 jitter) is what raises alarm, and a cluster a quarter to a semitone wide at C6 beats at exactly those rates. So the creep comes from three bounded additions, not from a new sound: a roughness/chaos layer on the hum itself, a cluster of six ghost voices within ±100 cents that widens with tension and closes on stillness, and the recordings as a far bed (the stretched screams) and rare events (the wails). Tension is a state that builds from the performers' cumulative unrest and never explodes.

- **Assumption:** one-hand patch on all four wrists, identical copies except the ombak offset, as Precipice.
- **Assumption:** the four copies cannot share state; each builds its own tension from its own wrist, and the room sums them.
- **Assumption:** a preloaded standby copy must not arrive already tense (it ticks unheard for the whole previous scene), so tension builds from *motion*, not from time; the scene's baseline tension is a scene parameter (`density`) so the scene file, not the clock, decides how unsettled the stage starts.
- **Assumption:** the beds recede with stillness but never vanish, and the wails keep a hard 10 s minimum gap — the hybrid rule from track D — so stillness still reads as the reward and the dread does not deflate.
- **Assumption:** the excursion stays within Precipice's quarter tone for the hum voices; the cluster is the only thing allowed a semitone.
- **Assumption:** the three files are Ciaran's to use; the licence rows in `SOURCES.md` are his to fill.

## 2. Context read

- `patching/profile.md`, `patching/context/README.md` (only file), `patching/notes/COS_Precipice.md` §4 (the base design) — read in full this session.
- References: `engine.md` §2–§5, §7; `patterns.md` §1, §3 (sample map + load guard), §4 (granular pad), §5 (refractory), §6, §7, §10–§12; `pitfalls.md` §5, §23, §25, §32, §33, §35, §40; `samples.md` in full.
- Takes: the Precipice take statistics (Still1/Still2/Still3/Writing) stand; unrest x medians 0 / 0.3 / 0.7 / 1.5–2.4.
- Samples (converted by `samples-check`, all 48 kHz mono in `samples/COS_Precipice2/wav/`):

| slot | source | length | loudness | peak | notes |
|---|---|---|---|---|---|
| wails | Discrete_wails_and_screams.wav | 106.5 s | −21.3 LUFS, LRA 20 | −5.4 dBFS | 17 separate cries, 2.1–4.9 s each, 5–10 s apart |
| high | High_stretched_female_scream.flac | 14.5 s | −20.1 LUFS | −11.3 dBFS | steady stretched bed |
| low | Low_stretched_male_scream.flac | 30.5 s | −14.1 LUFS | −1.6 dBFS | hot; the patch scales it |

  Cry cue table (start s, duration s), from silence gaps < −45 dB for > 0.4 s: (0.0, 2.81) (6.2, 2.28) (10.9, 2.09) (16.04, 2.32) (21.44, 2.82) (26.91, 2.42) (32.43, 3.12) (37.19, 2.81) (47.08, 4.94) (55.49, 3.75) (62.52, 3.42) (69.03, 2.88) (74.41, 3.34) (80.47, 3.84) (86.53, 3.72) (92.37, 4.68) (99.86, 3.98).

## 3. Findings

### A — Physics
1. Screams sit at 30–150 Hz amplitude modulation ("roughness") where speech sits at 4–5 Hz; roughness drives disturbance ratings and amygdala response — https://www.mpg.de/9323826/acoustic-signature-screams (Arnal 2015 press release; the paper was 403).
2. Roughness, not pitch, separates screams from matched neutral calls (f0 733 ± 457 vs 743 ± 470 Hz; roughness −0.74 vs −1.89 a.u.) — https://www.nature.com/articles/s41598-025-01560-8.
3. Ambiguous screams average f0 1243 Hz (596–1889) and 1.27 s: the C6 hum is inside the scream range — Anikin 2021, https://pmc.ncbi.nlm.nih.gov/articles/PMC7813245/ (Table 1).
4. Nonlinear phenomena: subharmonics at f0/2, f0/3 (a second lower voice), sidebands ≈ AM at ~30 Hz, chaos = fast random f0 jitter; "particularly common in cries, screams and roars" — Anikin 2020, https://cogsci.se/publications/2020_nonlin/anikin_2020_nonlinear.pdf.
5. Of the nonlinearities only **chaos** measurably raised alarm (+5 %, +7 % when it covers 80 % of the call); AM and subharmonics did not on their own — https://pmc.ncbi.nlm.nih.gov/articles/PMC12150040.
6. Horror films use noisy screams and non-musical sidebands and *suppress* abrupt pitch jumps — Blumstein 2010, https://pmc.ncbi.nlm.nih.gov/articles/PMC3001365/.
7. Paulstretch keeps frame magnitudes and randomises phases: attacks and roughness dissolve, the spectral envelope stays; so a stretched scream is a static bed and roughness must be re-added in synthesis *(inferred)* — https://polarity.me/posts/articles/2026-07-07-paulxstretch-paulstretch-explained/.
8. Lament contour: the Kaluli sa-yalab is a stable four-tone descent D–C–A–G (2nd, minor 3rd, 2nd); European death music favours descending minor semitones within a 3rd–4th phrase range — Feld 1990, https://journal.oraltradition.org/wp-content/uploads/files/articles/5ii-iii/6_feld.pdf; https://www.tagg.org/articles/deathmus.html.
9. Tension ratings weight loudness most, roughness and pitch height medium, onset rate slightly *negative*; ratings lag the audio by ~4.5 s; roughness memory 3–4 s — TenseMusic, https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0296385.
10. Infrasound evidence is weak and a PA will not carry it — Parsons 2012, https://www.sgha.net/library/INFRASOUND.pdf. Skipped.

So for the patch: roughness AM on the hum (audio-rate, 35–100 Hz random walk, depth with tension), a chaos jitter of a few cents, a subharmonic that grows with tension, screams as static beds with the roughness re-made in the hum, no pitch leaps, the sob figure biased to a descending step–third–step.

### B — Synthesis prior art
1. `GrainBuf` reads every argument at grain onset; per-grain jitter must come from `TRand` on the same trigger; `maxGrains` sizes memory only — local `GrainBuf.schelp`.
2. Long grains (0.15–0.4 s) at 8–15 /s overlap 3–6 and smooth a bed; ±0.6 random pan decorrelates — `TGrains.schelp` example; a drifting centre `Integrator.kr(BrownNoise.kr(0.001))` de-mechanises it.
3. `Warp1` is the cheapest single-UGen stretched bed but has no per-grain pan; the two source files are already stretched — local `Warp1.schelp`.
4. Cry events: one-shot Synths under an envelope that is 0 at both ends, start positions from an onset table with jitter, rate 0.9–1.15 so repeats differ, refractory in sclang *(inferred from the GrainBuf model)*.
5. Atmosphères opens on > five octaves; the bar 44–53 canon compresses a wide cluster to a minor third; "shimmering rapid vibrato" and high glissandi recur — https://en.wikipedia.org/wiki/Atmosph%C3%A8res.
6. Threnody: 52 strings, quarter-tone clusters that fan out and close, blocks timed in seconds (15 s builds, 10–11 s drops) — https://mawrgorshin.com/2022/05/31/analysis-of-threnody-for-the-victims-of-hiroshima/.
7. Roughness peaks at ~70 Hz AM for carriers above 1 kHz (30 Hz for low carriers); rough band 15–300 Hz; roughness ∝ depth^0.96 — https://pmc.ncbi.nlm.nih.gov/articles/PMC4691258/.
8. Synthesised harshness = multiply by a waveform at 90 ± 20 Hz; subharmonics, chaos and AM each lower perceived pitch 2–4 semitones and make the voice "bigger" — https://pmc.ncbi.nlm.nih.gov/articles/PMC8261225/.
9. A Shepard riser is 5 sines with `slope` ≈ 0.02 (an octave per 50 s) — adclib `Shepard.schelp`; rejected here (a harmonic stack against the piano, and the brief says bounded).
10. FFT freeze (`PV_MagFreeze`, `PV_Freeze`) exists and costs ~0.25 %/copy; skipped — the stretched files already are the freeze.

### C — Musical world
1. Ligeti: "you cannot actually hear the polyphony… a very densely woven cobweb", rules "as strict as Palestrina's" — https://en.wikipedia.org/wiki/Micropolyphony. Many slow hidden lines, no melody.
2. Requiem Kyrie: canon voices enter at the unison, entries stepping by a semitone; the range widens from a centre; "dirty patches… dissolve the bounds of equal temperament" — Bauer, https://escholarship.org/content/qt46d198sj/qt46d198sj.pdf.
3. Lontano: ~13 bars of near-stasis on a limited set centred on A♭4 at mp or quieter, doublings from m. 15, first crescendi mm. 36–39, one low eruption at m. 51 — http://fickleears.blogspot.com/2011/12/distance-as-illusion-in-gyorgi-ligetis.html.
4. Threnody's dread is *narrow* quarter-tone bands with uncoordinated vibrato, not width; a wide Atmosphères mass reads as awe *(inferred from 1–3 and A7)*.
5. At C6 the critical band is ≈ 158 Hz (Bark) / ≈ 137 Hz (ERB): roughness onset ≈ 8 Hz (13 c), peak ≈ 40 Hz (65 c); 50–100 c beats at scream rate; beyond ~160–260 c the cluster becomes texture — Plomp & Levelt 1965, https://www.mpi.nl/world/materials/publications/levelt/Plomp_Levelt_Tonal_1965.pdf; https://arxiv.org/pdf/2510.14159.
6. Under the Skin: microtonal writing that "sounds like unison… like a lot of people playing" — https://www.bfi.org.uk/sight-and-sound/interviews/away-from-picture-mica-levi-her-under-skin-soundtrack. The brief's crowd-unison.
7. Huron: tension is anticipation of an expected kind of event at an unknown moment; relief after tension feels bigger (contrastive valence) — https://www.doc.gold.ac.uk/~mas03dm/papers/huron06-review.pdf.
8. Paste-ready cluster stages (cents from C6): rest `[0]`; shimmer `[-25, -8, 0, 12, 25]`; cluster `[-100, -70, -35, 0, 25, 50]` (dread, biased downward); mass `[-300 … 120]` — peak only, not used here.

### D — Gesture and mapping
1. Left 4 Dead's Director: per-player intensity rises with events, decays over time, "does NOT decay while Infected actively engage"; team value = max; Build Up → Sustain Peak 3–5 s → Peak Fade → Relax 30–45 s; it changes *frequency* of events, not amplitude — https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf.
2. Spawn intervals are randomised (90–180 s), "not purely random, nor deterministically uniform" — same source. Jittered quasi-periodic beats Poisson.
3. Tension ratings: loudness first, roughness and pitch medium, onset rate slightly negative; 4.5 s lag — TenseMusic (as A9). Bed level and cluster roughness carry the arc; event count is secondary.
4. Habituation: N1 recovers over ~10 s gaps; startle probes 15–25 s apart habituate by the 4th–5th — https://pmc.ncbi.nlm.nih.gov/articles/PMC4238409/. Rule: ≥ 10 s between cries; rotate sample, pitch and pan; after 4 similar within 60 s force ≥ 30 s.
5. Wwise ambience one-shots at 5–9 s are texture rates, far too dense for a cry — https://gameaudioresource.com/2019/07/18/chapter-06-c-env-ambience/.
6. Forced relief (Director-style) would cut cries while the performer still moves; a refractory cap after a held peak is the bounded version *(recommendation)*.

So for the patch: T rises with excess unrest, freezes above x 2.5, leaks faster once the stillness credit is up, caps after 4 s at ≥ 0.9 with a 35 s calm; wails on a jittered schedule (mean gap 75 s → 11 s over T, hard floor 10 s), a twitch answered with probability 0.3 after 0.4–1.5 s; the beds recede with credit, never vanish.

### E — SuperCollider practice (local sources, measured on a private server, 16 copies)
1. `GrainBuf.ar(numChannels, trigger, dur, sndbuf, rate, pos, interp, pan, envbufnum, maxGrains, mul, add)` (`GrainUGens.sc:35`, spot-checked); a stereo bed at 20 grains/s × 0.15 s, interp 2 ≈ 0.14 %/copy; overlap (rate × dur) is the cost driver.
2. `PlayBuf.ar(numChannels, bufnum, rate, trigger, startPos, loop, doneAction)` (`BufIO.sc:6`, spot-checked); an active one-shot ≈ 0.08 %; free it with `doneAction` or it keeps costing.
3. `t_` prefix and `\name.tr` both build a `TrigControl` (`GraphBuilder.sc:160`, spot-checked).
4. `Env.sine(dur, level)` is a Hann window (`Env.sc:115`); `Done.freeSelf` = 2.
5. Six `SinOsc` cluster voices with `LFNoise2` glides and a `.clip(...).midiratio` bound ≈ 0.19 %/copy; `DynKlang` saves nothing; `Klang` cannot glide.
6. Audio-rate AM at 80 Hz ≈ 0.02 %; control-rate AM aliases (375 Hz control rate) — use `.ar`; two sub sines ≈ 0.03 %; `PitchShift` 0.09 %, `FreqShift` 0.13 % (skipped); FFT freeze 0.25 % (skipped).
7. `Buffer.readChannel(server, path, startFrame, numFrames, channels, action, bufnum)` (`Buffer.sc:104`); eight reads of the 106 s file ≈ 163 MB, 0.26 s warm; freeing a buffer under a running `GrainBuf` is safe (grains go silent).
8. `FreeVerb2.ar(in, in2, mix, room, damp)` (`FreeVerb.sc:10`, spot-checked) ≈ 0.1 %/copy — the affordable halo for the beds and cries.
9. `tanh(0.35)` = −0.34 dB: the near-linear ceiling from Precipice iteration 5 stands; keep the pre-shaper sum ≤ 0.5.

So for the patch: two `GrainBuf` beds (Dust triggers, `TRand` pan/pos/rate per grain, interp 2, maxGrains 16, LPF, FreeVerb2), one-shot `PlayBuf` cries in a per-copy Group with a 0.25 s / 0.6 s window, six-voice cluster inside the hum SynthDef, `.ar` AM and a sub sine; ≈ +0.6 %/copy on Precipice's 0.5 %.

### F — Steph's corpus
1. The dulcimer granular voice is the shape to re-host: `Dust.kr(density)` triggers (`AirConcert/personalities/cotf_dulcimer1.sc:158`), per-grain `TRand` pan ±0.4 (`:165`), position `(pos + TRand.kr(posSpread.neg, posSpread, trig)).clip(0.02, 0.98)` (`:166`), `rateSpread=0.008` (`:155`), `BufRateScale.kr(bufnum)` on the rate (`:163`).
2. Stillness freezes the scan: `Warp1.ar(1, buffer, lfo…, rate, splay, envbuf, 8, 0.3, 4)` with speed from motion (`Airsticks-RPI/personalities/violin2.sc:43, :78`) — the idea, not the (gravity-blind) code.
3. Fan-out for a bounded cluster: `pch * (1 / ((i*delta)+1))` (`Airsticks-RPI/personalities/nic1.sc:20`), delta 0 = unison.
4. Long-file excerpts are always random fractions with an `Env.perc` window (`AirConcert/personalities/cotf_voice1.sc:44, :157-161`); nothing in the corpus cues onsets — the cue table is new.
5. Refractory idioms: 1.2 s flick refractory (`AirConcert/personalities/BIRDY.sc:443`), rising-edge start (`BIRDY.sc:432`), PERCUSSION's tier hysteresis 0.60/1.10 up, 0.45/0.85 down (`AirConcert/personalities/PERCUSSION.sc:551-554`).
6. PERCUSSION's engagement integral is unclamped (`PERCUSSION.sc:560`) — pitfall 32; T here is clamped and motion-driven.
7. Roughness devices: AM rate from rotation 0.3–15 Hz (`Airsticks-RPI/personalities/brenton4.sc:49, :24`); wide stereo detune `[lr, lr * 0.96]` (`heatherLaugh1.sc:13`); `FreqShift` sparkle at `freq * 0.51` (`JUPITERSHARP.sc:70`) — the last skipped for cost.
8. Buffer guard and teardown: read mono in the completion action and re-check `notNil` (`SOPRANOVOICE.sc:82, :87`); capture and nil refs first (`:140-145`); free buffers last (`:154-155`, but 2 s is too slow — 0.5 s here).
9. Warnings: `ctx.voicePool`, `~onHalf`, `~onResync`, `m.com`, literal `~/Music` paths, unprefixed `\grainPad`/`\simple`, 1.5–2.5 s releases, bare `nil.set` — none lifted.

## 4. Design

- **Technique** — COS_Precipice unchanged (four-voice formant hum, unrest meter, tiers, sob, bloom, per-wrist ombak, NHHall) plus four bounded layers: (1) **roughness and chaos** inside the hum — audio-rate AM whose rate random-walks 35–100 Hz and whose depth follows tension, plus a few cents of fast f0 jitter, plus a subharmonic at f/2; (2) a **six-voice ghost cluster** inside the hum SynthDef, offsets `[-1, -0.7, -0.4, 0.25, 0.5, 0.8]` × a width that runs 10 → 100 cents with tension (downward-biased, C8), each voice gliding on an 8–15 s LFNoise2, hard-clipped at ±120 c; (3) two **granular beds** from the stretched screams (`high` above, `low` under, low-passed), Dust-triggered, whose level follows tension and unrest and recedes with the stillness credit; (4) **cries**: one-shot excerpts from the wail file, whole cries from the cue table, windowed, filtered by "distance", on a jittered schedule that tightens with tension and answers a twitch. It beats a single new sound (the brief says no dramatic change), FFT freezes (cost, and the files are already frozen) and a Shepard riser (a harmonic stack against the piano, unbounded by nature).
- **Idiom** — `patterns.md` §1 (long-lived hum, now three long-lived synths), §3 (sample map + load guard), §4 (granular pad), §5 (refractory), §6 (tiers), §7 (bloom), §10–§12.
- **Parameters**:

| parameter | value | from finding |
|---|---|---|
| tension rise | u = ((x − 1.5)/3).clip(0,1); T += u/1320 per tick (≈ 40 s of x ≥ 4.5 → 1) | D1, D3 |
| tension freeze | no leak while x ≥ 2.5 | D1 (Director) |
| tension leak | −1/1500 per tick (45 s) once credit > 0.5, else −1/5000 (150 s) | D1, D6 |
| tension cap | T_eff ≥ 0.9 for 4 s → 35 s calm (cry gap ×3, no new peak) | D1 (Sustain Peak 3–5 s, Relax 30–45 s) |
| baseline | T_eff = density + (1 − density) × T; `density` default 0.3 | assumption (no time-based creep: pitfall 32) |
| roughness AM | rate random walk 35–100 Hz (±3 Hz per tick); depth T_eff.lincurve(0.2, 1, 0, 0.45) × (0.4 + x/5) | A1, B7, B8, E6 |
| chaos jitter | LFNoise0 at 30 Hz × (T_eff × x.clip(0,4) × 1.5) cents, max 6 c | A4, A5 |
| subharmonic | f/2 sine at T_eff × 0.25 (+ the bloom's 0.2) | A4, B8 |
| cluster | 6 voices, offsets [-1, -0.7, -0.4, 0.25, 0.5, 0.8] × width; width T_eff.lincurve(0,1, 10, 100, 1) cents, lag 10 s up / 20 s down; glides LFNoise2 0.08–0.13 Hz × 30 %; level T_eff.lincurve(0,1, 0.05, 0.25) | C2, C5, C8, B6, F3 |
| bed `high` | GrainBuf stereo, Dust 6 + 4x /s, dur 0.25, pos wander 0.05 Hz ± 0.05, rate 1 ± 0.02, LPF 2.5 → 7 kHz; level T_eff.lincurve(0,1, −40, −18) + 2x − 6·credit dB; lagud 8 / 25 s | B1–B2, F1, D3, D6 |
| bed `low` | as high, LPF 300 → 900 Hz, level T_eff.lincurve(0,1, −40, −16) − 4·credit dB, rate 1 ± 0.015 | B2, F1 |
| cries | mean gap T_eff.linexp(0,1, 13, 6) s (iteration 3, for a ~30 s scene), jitter ×0.75–1.25, hard floor 6 s, ×2 during calm; fires only with tier ≥ 1 or T_eff > 0.15; a tier jump 0→≥2 arms one with p 0.5 after 0.4–1.5 s; after 6 cries in 60 s the next gap ≥ 20 s; pick excludes the last 4 cues; rate 0.9–1.15, pan ±0.7, LPF 2.5 → 7 kHz, level T_eff.lincurve(0,1, −14, −4) dB (iteration 2); window 0.25 s in / 0.6 s out | D2, D4, D5, A6, B4, F4–F5 |
| gain staging | hum unchanged (≤ 0.25 pre-shaper); beds ≤ 0.12; one cry ≤ 0.15; cluster ≤ 0.25 of the hum mix; pre-tanh sum ≤ 0.5 | E9 |
| memory | 3 buffers per copy ≈ 29 MB; 8 copies ≈ 230 MB | E7 |

- **Pitch world and time** — the hum's pitch world is Precipice's (one note, quarter-tone departures). The cluster lives around it within ±100 c, biased downward, and closes to ±10 c at rest. The beds keep their own (stretched) pitch. Cries are transposed −2…+2.4 semitones only so repeats differ. Time: the cry schedule is the only event rhythm (jittered, never regular); tension has no clock.
- **Mapping** — performer terms first:

| gesture (piano / drum terms) | model source | → parameter | in range | out range | curve / smoothing | why |
|---|---|---|---|---|---|---|
| arm held still (as in Precipice) | x ≈ 0, T at baseline | the hum as before; beds far and low; cluster a 10 c shimmer; no cries (unless T_eff > 0.15, then a distant one every ~75 s) | — | beds −40 dB rel | lagud 8/25 s | stillness is still the reward; the room is merely not empty |
| a breath, a twitch (Still2) | x 0.3–2, tier 1–2 | tremor/sob as before; a cry may *answer* (p 0.3, 0.4–1.5 s later); beds lift 2 dB per unrest step | x 0–3 | +0…+6 dB | — | reactivity: the room notices |
| a slow drift, ghosting (Still3) | x 1–3 sustained | T rises; cluster widens, roughness depth grows, cries come closer together | T 0→1 | width 10→100 c; AM 0→0.45 | T lag; width 10/20 s | tension builds from failure to be still |
| a real gesture (writing, a stroke) | mot > 0.6, tier 3 | the quarter-tone tip-over as before, chaos jitter up to 6 c, T freezes its leak | — | — | — | the peak of a gesture is also its cost |
| twenty seconds of true stillness | credit → 1 | bloom as before; beds duck 6 / 4 dB; T leaks faster | — | — | lag 1 s / 8 s | relief that is audible (Huron) |
| minutes of sustained unrest | T_eff ≥ 0.9 for 4 s | calm 35 s: cry gap ×3 | — | — | — | the ceiling: it cannot keep escalating |

  Model fields: as Precipice (`mot`, `floor`, `x`, `tier`, `credit`) plus `tension` (T) and `tEff`.
- **At rest / stillness** — the Precipice rest hum with a faint 10 c ghost cluster and the beds at −40 dB relative (present, far); the bloom as before, now also ducking the beds. Nothing fires at rest below T_eff 0.15.
- **Two-hand** — n/a.
- **Standby and exit** — T, credit, floor, mot all clamped; the cry schedule needs tier ≥ 1 or T_eff > 0.15, so a still standby copy fires nothing; at most ~2 cries can overlap (10 s floor vs 5 s max cry); beds fed only by their own grains. `~deinit`: gate the hum and both beds (0.15 s release), free the cry group, free buffers after 0.5 s.
- **Level and CPU** — rest ≈ −25 dBFS per copy (hum) with the beds ≥ 15 dB under it; a cry at T 1 ≈ −16 dB relative to the hum's peak; hard gestures ≈ −10 dBFS as Precipice. Estimated ≈ 1.1 %/copy (hum 0.5, beds 0.3, cluster 0.2, cry 0.08, reverbs 0.1), ≈ 9 % for eight.
- **Samples** — `wails`, `high`, `low` (§2); `SHOPPING.md` written, files supplied by Ciaran, `samples:check` 3/3 converted; licences to confirm in `SOURCES.md`.

## 5. Params

| key | type / range | default | what it changes audibly |
|---|---|---|---|
| register | low \| mid \| high | mid | the held note: C5 / C6 / C7 |
| pitchset | harmonics \| quarter \| gamelan | harmonics | where the tip-over lands (as Precipice) |
| brightness | 0–1 | 0.5 | harmonics and upper partials of the hum |
| wet | 0–1 | 0.5 | the hum's halo (NHHall mix) |
| density | 0–1 | 0.3 | **baseline tension** for the scene: how unsettled the room is before anyone moves (beds, cluster width, roughness, cry rate) |

Header line: `params: register (low|mid|high, mid), pitchset (harmonics|quarter|gamelan, harmonics), brightness (0–1, 0.5), wet (0–1, 0.5), density (0–1, 0.3)`.

## 6. Hand-off

- **What it is** — Precipice with the room gone wrong: the same hum, but a ghost cluster around it, a rough scream-like edge that grows the longer you fail to be still, two far stretched-scream beds under and over the note, and rare distant cries that answer a twitch and come closer as tension builds — with a ceiling.
- **How to play it** — exactly as Precipice. Be still and the room stays far. Twitch and something may answer a second later. Keep drifting and the cluster widens, the hum roughens, the cries close in; go still and it all recedes over half a minute. It cannot escalate forever: after a held peak it backs off for a while on its own.
- **Listen for** — at rest: the hum plus a faint shimmer and a far bed; gently: a distant cry after a twitch; hard/sustained: the roughness (a buzz at 35–100 Hz on the hum), a lower second voice, the cluster a semitone wide and sagging; the reveal: the bloom now also pushes the beds away.
- **Scene params worth trying** — `density=0.6` (the room already tense when the scene starts), `density=0.1` (almost Precipice), `register=low`, `wet=0.3` (drier hum against the beds).
- **Checks** — compile: `COS_Precipice2.sc.tmp: parses` (after moving a late `var` to the top — the classic); lint: 0 errors (roster warning until added); audition PASS (final, density 0.3):

```
rest ceiling -18.0 dBFS (settled peak of rest/still/settle)
phase  | seconds | peak dBFS | rms dBFS | verdict
-------|---------|-----------|----------|-------------------
rest   | 2       | -26.5     | -34.5    | ok (settled -26.5)
tilt   | 3       | -19.7     | -26.3    | ok
sway   | 4       | -20.2     | -26.3    | ok
shake  | 3       | -19.2     | -26.6    | ok
strike | 3.5     | -17.0     | -24.4    | ok
still  | 4       | -23.0     | -30.6    | ok (settled -23.0)
settle | 1.5     | -23.6     | -29.9    | ok (settled -23.7)
server cpu (max) 6.7 %
AUDITION PASS (26.4 s)
```
  Still2 replay PASS: −17.0 / −19.9 / −19.2 / −11.8 (the twitch) / −15.8 / −15.7 per 5 s window, cpu 6.7 %. Writing1 (second audition, before the teardown fix): −13.5 → −9.2 over 30 s as tension builds. Quick at density 0.8: rest −25.8, settle −16.0 (beds and cluster audible at rest, as designed); samples: 3/3 converted, `SOURCES.md` licences to fill.
- **Open questions** — Are these three recordings cleared for use (fill `SOURCES.md`)? Is `density` the right name for baseline tension, or should the scene file get a dedicated key? Should the cries also be allowed at true rest (T_eff below 0.15) once a scene is meant to be creepy from its first second?

## 7. Sources

See §3; every URL and `file:line` is inline. Code borrowed: techniques only. Local measurements: track E's private-server benchmarks (`scratchpad/m3.scd`, `res.txt`); sample statistics from ffmpeg (ebur128, astats, silencedetect) in session.

## 8. Iteration log

2026-09-29 — first version written from the research above; not yet heard by Ciaran.
2026-09-29 — first audition: every level −inf and thousands of `/n_set Node not found`. Not the patch: the track E research benchmark had created a private server without `Server.default = s`, so its synths and frees hit the live engine's scsynth and emptied its node tree (the control patch was silent too). Engine restarted with Ciaran's OK; rule added to `research.md` track E.
2026-09-29 — second audition (fresh engine): synthetic rest −27.2, tilt −19.4, sway −14.1, shake −16.8, strike −16.8, still −20.2 (settled −22.6), settle −23.5, cpu 6.5 %; Writing1 −13.5 → −9.2 over 30 s (tension building: cluster and beds add on top of the hum); quick at density 0.8: rest −25.8, shake −16.4, settle −16.0 (beds and cluster present at rest, as designed). One error line per run: `/g_freeAll Group N not found` from my `~deinit` — a bundled `g.freeAll` (s.bind, +50 ms) followed by an immediate `g.free`, which arrives first (pitfall 26). Iteration 1: `g.free` alone (it frees the group's cries with it).
2026-09-29 — final gate after iteration 1: synthetic PASS (above), Still2 PASS, no error lines; cpu 6.7 % on the live engine with the runner beside it. Committed to AirKit; not yet heard by Ciaran.
2026-09-29 — **heard by Ciaran** (X0 as ZL, audition slot): "nearly there"; the discrete cries are inaudible. Cause: at density 0.3 a cry peaked ≈ −28 dBFS (under the −26 hum) and the schedule gave one per ~40 s. Iteration 2: cry level +12 dB (−14 → −4 dB pre-sample, peaks ≈ −18 → −9 dBFS over tension), filter floor 2.5 kHz, mean gap 45 → 8 s (floor 8 s), twitch answer p 0.5, first cry eligible after 8 s.
2026-09-29 — Ciaran on iteration 2: more frequent — this scene may last only ~30 s, so "10–15 s on the scream gate". Iteration 3: mean gap 13 s at baseline → 6 s at full tension (jitter ×0.75–1.25, floor 6 s, ×2 during calm), first cry eligible within 5 s, habituation relaxed to six in a minute → ≥ 20 s. Saved while he was auditioning (hot-reloaded on ZL, with notice).
2026-09-29 — iteration 3 gate: a Still2 replay "passed" with the level collapsing to −330 dBFS from 11 s on. Not the patch: Ciaran pressed PANIC on Admin at 14:58:01 during the tool's run (panic fades every monitor to 0 and loads silence on every device, the tool's included). A posting debug copy (`COS_P2dbg`, since removed) replayed Still2 cleanly: x 0–6, floor 0.003–0.09, tEff 0.30–0.32, credit 0.1→1.0 in ~25 s, tiers 0–3 as designed, ampDb −16.7 at rest to −3.6 on the twitch; peaks −14…−20 dBFS, cpu 7.3 %. Lesson for the workflow: the audition tool shares slot 9 with the runner, so Admin actions (audition, PANIC) during a run invalidate its readings — run the gate only while Admin is idle.
2026-09-29 — Ciaran on iteration 3: "all sounds good" — **locked** at AirKit e652afb. Still open: `SOURCES.md` licence rows.
**Next round (Precipice3), Ciaran's brief:** make the next step of this patch totally responsive to *pitch angle* — the AirStick's pitch, i.e. the arm's angle — so that the shakes and the cries are locked into the angle Claire and Zubin actually play at. (Model field: `gyroYFiltered`, −1…1 = pitch / (π/2); measure the playing angles from takes on their wrists first.)
