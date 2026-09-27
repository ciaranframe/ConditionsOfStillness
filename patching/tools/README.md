# patching/tools

Node ≥ 22.18 TypeScript, run directly (`node <file>.ts`), no framework. Tests live in
`test/*.test.ts` (`npm test` here; the root `npm test` runs them too). Shared helpers in `src/`.

| Tool | Does | Usage |
|---|---|---|
| `patch-compile.sh` | Headless sclang parse check of a personality (~3 s); never executes it. Exit 0 parses, 1 doesn't, 2 no such file. | `patch-compile.sh <Name\|path>` |
| `corpus-mine.ts` (Task 2) | Mines `personalities/`/`synths/` off every AirKit branch via git objects only (nothing checked out); writes `patching/corpus/index.json`, `INDEX.md`, `digest.md`. | `npm run corpus:mine` |
| `patch-lint.ts` (Task 3) | Profile-driven rule check: naming, roster membership, scene-param hooks, `~partner` guards, sample-path discipline, SynthDef prefix, allowed UGen classes. | `npm run patch:lint -- <Name>` |
| `patch-roster.ts` (Task 4) | Adds or removes a patch in `airkit/lists/list_conditions.sc`, atomically, keeping the `silence` bookends. | `npm run patch:roster -- add\|remove <Name>` |
| `take-record.ts` (Task 4) | Records one wrist's raw IMU stream to `takes/<label>.take.jsonl`; appends a row to `takes/INDEX.md`. | `npm run take:record -- <label> <wrist>` |
| `patch-audition.ts` (Task 6) | Loads a patch on slot 9 through a private device and drives it with synthetic gesture phases or a recorded take; reports levels and any interpreter errors. | `npm run patch:audition -- <Name>` |
| `samples-check.ts` (Task 7) | Matches downloaded files to sample slots, converts to 48 kHz WAV, writes `manifest.json` and a `SOURCES.md` skeleton. | `npm run samples:check -- <Name>` |

Tools marked with a task number don't exist yet; the row documents what they'll do when that task
lands. `src/atomic.ts` — `writeAtomic`, used by every tool that edits a checked-in file (temp
path + rename, so a half-written file is never observable). `src/sc.ts` — `SCLANG`, `repoRoot`,
`airkitRoot`, `personalityPath`, `rosterPath`, `compileCheck` (the TypeScript form of the compile
check; `patch-compile.sh` itself is a standalone shell script with the same idiom).
