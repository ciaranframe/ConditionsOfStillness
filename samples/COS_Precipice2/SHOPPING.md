# COS_Precipice2 — samples to find

For the patch `airkit/personalities/COS_Precipice2.sc` (research note `patching/notes/COS_Precipice2.md`).
Download into this folder (not `wav/`) under a filename that **starts with the slot name and a
hyphen** (`<slot>-anything.wav`) or is exactly `<slot>.<ext>` (case doesn't matter), then run
`npm run samples:check -- COS_Precipice2`. Formats: wav aif aiff flac mp3 ogg m4a; any sample rate
and channel count (converted to 48 kHz, and to the row's mono/stereo). A length outside the
range is only a warning. Licences: CC0, CC-BY (record the attribution in
`SOURCES.md`), or your own recording — nothing NC/ND, nothing without a stated licence.

Ciaran supplied all three files himself on 2026-09-29 (from ~/Downloads); the licence column is
his to confirm in `SOURCES.md`.

<!-- The table below is parsed by patching/tools/samples-check.ts: keep the header row exactly.
     length: "≤ N s" | "A–B s" (en dash or hyphen) | "N s" (= N×0.5 … N×2); "any";
     channels: mono | stereo (the converted file's); pitched: yes | no. -->

| slot | what | length | channels | pitched | licence |
|---|---|---|---|---|---|
| wails | a long file of separate human wails and screams with silence between them, dry | 60–180 s | mono | no | to confirm (Ciaran's library) |
| high | a high female scream time-stretched into a slow, breathy bed | 10–30 s | mono | no | to confirm (Ciaran's library) |
| low | a low male scream time-stretched into a slow, dark bed | 15–60 s | mono | no | to confirm (Ciaran's library) |

## wails

- **Listen for:** distinct cries with real silence between them (the patch cues whole cries by their onsets); reject a file with music or a constant bed under it.
- **Why:** one-shot "cry" events at tip-overs and tension peaks; each event is one cry, windowed, rate-limited.
- **Pitch:** n/a
- **Search:** supplied.

## high

- **Listen for:** a steady, slowly evolving stretched voice with no clicks; the middle 80 % is what the grains read.
- **Why:** the upper halo layer — a granular bed above the note that surfaces with unrest and tension.
- **Pitch:** n/a (grains are pitch-shifted by ratio in the patch)
- **Search:** supplied.

## low

- **Listen for:** as `high`, an octave or more lower; peak-normalised is fine (this file is hot, −1.6 dBFS; the patch sets level).
- **Why:** the layer under the note — a dark bed that grows with tension.
- **Pitch:** n/a
- **Search:** supplied.
