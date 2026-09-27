# COS_<Name> — samples to find

For the patch `airkit/personalities/COS_<Name>.sc` (research note `patching/notes/COS_<Name>.md`).
Download into this folder (not `wav/`) under a filename that **starts with the slot name and a
hyphen** (`<slot>-anything.wav`) or is exactly `<slot>.<ext>` (case doesn't matter), then run
`npm run samples:check -- COS_<Name>`. Formats: wav aif aiff flac mp3 ogg m4a; any sample rate
and channel count (converted to 48 kHz, and to the row's mono/stereo). A length outside the
range is only a warning. Licences: CC0, CC-BY (record the attribution in
`SOURCES.md`), or your own recording — nothing NC/ND, nothing without a stated licence.

<!-- The table below is parsed by patching/tools/samples-check.ts: keep the header row exactly.
     length: "≤ N s" | "A–B s" (en dash or hyphen) | "N s" (= N×0.5 … N×2) | "any";
     channels: mono | stereo (the converted file's); pitched: yes | no. -->

| slot | what | length | channels | pitched | licence |
|---|---|---|---|---|---|
| <slot> | <what to find, one line> | <0.2–1 s> | <mono> | <no> | <CC0 or CC-BY> |

## <slot>

- **Listen for:** <the quality that matters; what to reject (noise, reverb, other sounds)>
- **Why:** <what the patch does with it — e.g. grains read from its steady middle, so 2 s of
  even material matters more than the attack>
- **Pitch:** <n/a | the note to look for, or "any clear pitch; tell me which">
- **Search:** <Freesound terms; filters: licence CC0/Attribution, duration>
