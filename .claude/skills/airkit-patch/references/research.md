# Research playbook — from a brief to a sound design

A brief might be "glass harmonica heard underwater", "the hum of the piano's frame after a
chord", "breath through a drum skin", "something like frost". Research turns it into **numbers
and decisions**: partial ratios, envelope times, modulation rates, event statistics, a pitch
world, a gesture mapping, a CPU budget. A finding that cannot change a line of the patch was not
worth finding. Budget: real effort — six parallel tracks, a dozen or more sources read
properly, not search snippets. Adapted from Glimmer's `research.md` (four tracks), with a
SuperCollider-practice track and a corpus track added for this piece.

## 0. Read the context, then the brief, like a composer

Read the profile and **every file in `patching/context/`** in full first; the scene notes shape
the sound more than the brief does. Then write down, in the note (`assets/note-template.md`):

- **Referent** — what is the sound, literally: an instrument, a process, a material, a place, a
  named work, an image?
- **Role in the room** — this is chamber music with electronics: the piano and bass drum must
  still be heard. Foreground or halo? Which wrist, which performer, one hand or `2H`?
- **Playing vs free gesture** — does the sound answer ordinary playing (key attacks, rolled
  chords, tremolo, drum strokes, damping) or gestures made between/instead of playing?
- **Stillness** — what is audible at near-zero motion. Never "nothing, by default".
- **What is not said** — register, density, tonal/noisy, steady/eventful. Decide, mark each as
  an assumption.
- For an abstract brief choose 2–3 concrete referents that could carry it; research those and
  say which you chose and why.

Ask Ciaran only when two readings lead to different instruments. Otherwise decide and record.

## 1. Six tracks, in parallel

Dispatch one subagent per track, **all six in one message** (Agent tool, `general-purpose`).
Subagents cannot see this file: paste the brief, the context summary, the track's questions,
the shared constraints and the return format (§2) into each prompt. Use the session's search
tools (WebSearch/WebFetch, exa, firecrawl for PDFs, context7 for SuperCollider docs).

**A — physics of the thing.** How is the real sound made, what is measurable? Spectrum
(partial ratios, inharmonicity, formants, noise bands), envelope (attack/decay/release, how
decay varies with pitch), modulation (beating, vibrato, flutter: rates and depths), for textures
the event statistics (rate, size and pitch distributions, clustering), loudness behaviour,
radiation/space. Sources: JASA, DAFx, ICMC/SMC, Acta Acustica; Fletcher & Rossing; maker and
tuner documentation; bioacoustics for animals. Numbers with units.

**B — synthesis prior art.** How have people synthesised it, and what carries it in
SuperCollider? sccode.org, scsynth.org, sc-users archive, GitHub `language:SuperCollider`, the
SuperCollider Book, Farnell *Designing Sound* (translate the model, not the patch), Cook *Real
Sound Synthesis*/STK, J. O. Smith's online books (modal, waveguide, FM), Risset/Chowning
catalogues, *Synth Secrets*. Return the technique, parameter values, short fragments with URL
and licence. Borrow techniques and numbers; do not paste someone's patch.

**C — musical world.** The patch carries its own pitch and time (no conductor). Tunings in
cents or ratios, scales/modes, register, interval vocabulary, contour, rhythm and density
language of the referent; how phrases start and end. How this sits **against a piano in equal
temperament and an unpitched bass drum**: consonant with the piano, deliberately beating
against it, or pitch-neutral? For a living tradition, aim at an informed evocation and say so.
Pitch sets ready to paste (MIDI floats, cents, ratios).

**D — gesture and mapping.** How is the real thing excited and controlled, and what is the
metaphor for a pianist's or drummer's wrist? Which movement *causes* the sound, which *shapes*
it, what happens at rest, what rewards staying with it a minute, what one-hand vs two-hand
design gives. Sources: NIME proceedings and the DMI mapping literature (Hunt & Wanderley on
one-to-many / many-to-one; Wessel & Wright on intimacy and latency; energy-input metaphors;
Tanaka; Fels on transparency), wearable/wrist-IMU instruments (AirSticks, Mi.Mu), how
comparable instruments map accelerometer and orientation data. Return a mapping table proposal.

**E — SuperCollider practice.** Which UGens and structures realise the design within budget.
For each candidate UGen: the real signature and ranges from the **local** help
(`~/Library/Application Support/SuperCollider/Help/Classes/<Name>.html`, or the class source in
`/Applications/SuperCollider.app/Contents/Resources/SCClassLibrary` and
`~/Library/Application Support/SuperCollider/Extensions/SC3plugins/`), mono/stereo, buffer
needs, stability limits, CPU relative to alternatives. sc3-plugins are installed and allowed
(`JPverb`, `Greyhole`, `MembraneCircle`, `DWGBowed`, `OteyPiano`, `MdaPiano`, `BMoog`, `DFM1`,
`NHHall`, STK…). Budget: **eight patches run all the time** (four wrists × live + standby) at
blockSize 128, so one copy should be a small fraction of scsynth's load; prefer control-rate
modulation, a bounded voice count, one shared effect per patch. Return UGen choices with
argument lists verified, a CPU estimate method (the audition prints `serverCpu`), stability
guards (clip, `LeakDC`, ceilings).

**F — Steph's corpus.** What has already been built on this engine that is close to the brief?
The mined corpus is 574 entries (561 unique blobs) from five AirKit branches
(`patching/corpus/stats.md`).

- `patching/corpus/INDEX.md` — per branch, a table of name, idiom (`pdef`/`synth`/`hybrid`/
  `ndef`/`none`), UGen count, samples, size, other branches. Skim for names and idioms.
- `patching/corpus/index.json` — `{ branches, entries }`; each entry has `name`, `kind`
  (`personality`/`synth`), `raw` (path under `patching/corpus/`), `branches[{branch, path}]`,
  `duplicateOf`, and `facts{ headerKeys, ugens, idiom, modelFields, hooks, thresholds,
  samples, lines }`. Query it, e.g.:
  `node -e 'const j=require("./patching/corpus/index.json");for(const e of j.entries)if(e.kind==="personality"&&e.facts.ugens.includes("DynKlank"))console.log(e.raw,e.facts.idiom)'`
  — swap the predicate for a UGen, a model field (`gyroYFiltered`), a hook, `samples`, a
  threshold range.
- `patching/corpus/digest.md` — recurring logics with pointers (written once from the mined
  files; if it is absent, say so and work from the index).
- Raw files exist only in the main checkout (gitignored). Read the 2–5 closest in full.

What to take: *logic* (a detector, a mapping curve, an envelope, a voicing rule, a threshold
together with its input mapping) — re-hosted in `~idleNext`, with a comment naming the source
file. What not to take: pitch from `ctx.voicePool`/`m.com`, rhythm from beat hooks or `~onHit`,
literal sample paths, unprefixed SynthDef names (`pitfalls.md` §28). Cite as
`patching/corpus/<branch>/personalities/<file>:<line>`. Also read the matching recipes in
`~/AirKit/code3.0/concert_p_files.md` (§15–§27) and `personality_authoring.md` (§3 palettes, §8
reference characters).

### Constraints to paste into every track prompt

> SuperCollider 3.x on macOS, core UGens plus sc3-plugins 3.14. Control data: a ~33 Hz tick of
> gravity-included acceleration energy, rotation rate and tilt (−1…1) from an IMU on a
> performer's wrist — a pianist (small fast key accelerations, wrist turn on rolled chords,
> tremolo = sustained fine shake) or a bass drummer (stroke = spike + rebound, damping = sudden
> stillness). Either hand may be resting. Output: stereo into a PA shared with an acoustic
> piano and bass drum in a chamber setting; peaks −12…−6 dBFS shaken hard. Up to eight patches
> run at once (live + preloaded standby per wrist), so CPU per copy must be modest. Stillness is
> the piece's subject: at-rest behaviour must be designed. Scene parameters (register,
> density, brightness, pitchset, rate, wet) may retune the patch per scene.

### Subagent brief template (one per track; fill the brackets)

```
You are researching Track [A–F: name] for a SuperCollider sound design.
Brief (verbatim): "[brief]"
Context (from the piece's scene notes): [3–6 lines]
Referents chosen: [1–3]
Questions for this track: [the track's questions from research.md §1, specialised to the brief]
Constraints: [the constraints block above]
Return exactly: 5–12 findings (one sentence each, with a number or a concrete rule, and the
source URL or file:line; mark anything not read directly as (inferred)); disagreements between
sources; "so for the patch…" (3–6 bullets); sources actually opened, one line each on what it
gave. No snippet-only citations; if a page or PDF would not open, say so. Do not write the patch.
```

## 2. What each track returns

- **5–12 findings**, each a sentence with a number or a concrete rule, each with its source
  (URL, `file:line`, or book + page). *(inferred)* on anything not read.
- **Disagreements** between sources — often the interesting part.
- **So for the patch…** — what this track says the patch should do.
- **Sources opened**, one line each.

Spot-check the two or three numbers the design will lean on hardest by opening the source
yourself. Subagents compress, and sometimes invent.

## 3. Synthesise into a design

1. **Technique** — one synthesis approach, and why it beats the runner-up *here*: CPU × 8,
   playability, how it sits against the piano and drum, how it degrades on a small speaker.
2. **Idiom** — the `patterns.md` shape(s): long-lived synth, Pdef, one-shots in a Group,
   granular pad, bed + foreground.
3. **Parameters from the research** — ratios, times, rates, distributions, each with the
   finding it came from.
4. **Pitch world and time** — the set(s), how a note is chosen, what moves it; how `register`
   and `pitchset` change it.
5. **Mapping table** — every gesture source → parameter, input range, output range, curve,
   smoothing, reason; written first in the performers' terms (a rolled chord, a tremolo, a
   stroke, a damp) and then in model fields. Include rest behaviour, one reveal that only
   sustained or unusual play (or stillness) unlocks, and, for `2H`, what each hand does.
6. **Scene parameters** — which keys, defaults, what each changes audibly.
7. **Exit and standby** — what accumulates while unheard (nothing unbounded), release time.
8. **Level plan and CPU** — expected peaks, where the ceiling is, estimated load.
9. **Samples** — only if synthesis cannot carry it; the slots for `SHOPPING.md` (`samples.md`).

Verify every UGen against the local help before writing it (track E's list).

## 4. The note

Write `patching/notes/COS_<Name>.md` from `assets/note-template.md` **before** the patch; keep it
true as the patch changes. If a finding is reusable across patches (a good membrane model, a
bell partial table, a mapping that felt right), say so at the top of the note.
