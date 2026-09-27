# Profile schema — what a piece profile must contain

The skill is generic; everything piece-specific lives in one Markdown file, the **profile**
(default `patching/profile.md` of the current repo; `/airkit-patch <brief> --profile <path>`
overrides). It has two layers: a **YAML front-matter** block that tools parse, and **prose
sections** that the skill (and the research subagents it briefs) read. This file lists both,
using the Conditions of Stillness profile as the worked example.

## 1. Front-matter (machine-read)

Between the leading `---` lines; parsed by `loadProfile` in `patching/tools/src/lint.ts`, which
throws if a string key is missing or empty or a list key is not a list of strings. Paths are
repo-relative (absolute also accepted).

| key | type | example | what it is for | read by |
|---|---|---|---|---|
| `prefix` | string | `COS_` | patch-name prefix; names must be `<prefix><UpperCamel>` | lint `name.cos-prefix`; the skill names files |
| `synthdefPrefix` | string | `cos` | SynthDef-name prefix (`\cos<Name>…`), because SynthDef names are process-global | lint `synthdef.prefix` |
| `roster` | path | `airkit/lists/list_conditions.sc` | the engine's personality list, `["silence", …, "silence"]` | lint `roster.missing`; the skill's roster step |
| `personalities` | path | `airkit/personalities` | where patch files live; also scanned for SynthDef collisions, and its parent's `code3.0/conditions/*.scd` for engine SynthDefs | lint `synthdef.collision`; the skill writes here |
| `template` | path | `airkit/personalities/COS_Template.sc` | the runnable skeleton a new patch is copied from (a pointer, never a copy) | the skill (write step) |
| `headerKeys` | list | `[gestures, description, internals, sound, pitch, rhythm, family, params, samples, research]` | the header block's keys, in order | lint `header.keys`; `assets/header-template.txt` |
| `optionalHeaderKeys` | list | `[internals, research]` | header keys whose absence only warns | lint `header.keys` (W) |
| `samplesVar` | string | `cosSamples` | the `topEnvironment` key holding the samples root | lint `sample.manifest`, `banned.abs-path` message; `samples.md` |
| `plugins` | bool | `true` | whether sc3-plugins classes are allowed (the `SC3plugins` Extensions folder is indexed) | lint `class.unknown` |
| `gestureWords` | list | `[sway, shake, tilt, strike, stillness, hold, turn, flip, twist, roll, direction]` | the closed vocabulary for `gestures:` | lint `header.gestures-grammar` |

Tools that do **not** read the profile today: `patch-roster.ts` (name rule `COS_` and roster
path are fixed in `src/roster.ts` / `src/sc.ts`), `patch-compile.ts`, `patch-audition.ts`
(slot 9 and ports are its own flags), `samples-check.ts` (samples folder by `--dir`). A second
piece would need those parameterised; the skill must not assume they follow the profile.

## 2. Prose sections (skill-read)

Headings as in `patching/profile.md`. The skill reads the whole file before research and pastes
the relevant parts into subagent briefs.

| section | must say | used for |
|---|---|---|
| **Piece and instruments** | who wears which sticks, their names (`ZL ZR CL CR`), what ordinary playing looks like to the IMU, what the non-playing hand does, what rest means musically | research tracks A/D constraints; the mapping table; hand-off language |
| **Naming** | the name and two-hand (`2H`) rules, the SynthDef prefix, with examples | write step; lint expectations |
| **Roster path** | the roster file, its shape, how to edit it (tool only) | roster step |
| **Template** | the skeleton's path and the load-bearing idioms it carries | write step |
| **Scene-parameter contract and recommended keys** | when params arrive (before or after load), the hook, the recommended keys with ranges (`register` low/mid/high, `density` 0–1, `brightness` 0–1, `pitchset` name, `rate` Hz, `wet` 0–1) | design §6 of the note; `patterns.md` §10; header `params:` |
| **Two-hand contract** | which slot a `2H` patch loads on, what `~partner` is, what happens to the other wrist, re-read-every-tick rule | design; lint `partner.guard`/`name.two-hand` |
| **Level plan** | the PA, target peaks (−12…−6 dBFS shaken hard), the ensemble-first rule, the limiter's role | design §8; audition verdicts |
| **Plugins** | what is installed and allowed | track E; lint |
| **Audition** | the audition slot and command | audition step |
| **Takes** | where recorded wrist streams live, their index | calibration; audition `--take` |
| **Samples** | the folder layout, the check command, the loading rule | `samples.md` |
| **Hand-off format** | how to describe gestures (performer terms, not IMU terms), what to say about rest vs shaken, which params to try | the hand-off |
| **Where context lives** | the context folder (`patching/context/`) and that it is read in full first | step 1 of the skill |
| **Research note location** | `patching/notes/<prefix><Name>.md` and the template path | the note step |

## 3. Rules for a profile

- Front-matter keys are exactly those in §1; unknown keys are ignored by the linter, missing
  ones stop it. Keep lists inline (`[a, b]`).
- The prose must be true of the engine it describes: when the engine and the profile disagree,
  the patch follows the engine, and the hand-off names the profile line that needs fixing.
- A profile never contains a patch or a copy of the template — only pointers.
- Changing `gestureWords`, `headerKeys` or the prefixes changes what lint accepts for every
  existing patch: re-lint them all after the edit.
