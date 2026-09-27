# COS_<Name> — samples to find

For the patch `airkit/personalities/COS_<Name>.sc` (research note `patching/notes/COS_<Name>.md`).
Download into this folder under any filename that **starts with the slot name and a hyphen**
(`<slot>-anything.wav`), then run `npm run samples:check -- COS_<Name>`. Any format ffmpeg reads;
any sample rate (converted to 48 kHz). Licences: CC0, CC-BY (record the attribution in
`SOURCES.md`), or your own recording — nothing NC/ND, nothing without a stated licence.

<!-- The table below is parsed by patching/tools/samples-check.ts: keep the header row exactly.
     length: "min–max s" or "≤ N s"; channels: mono | stereo; pitched: yes | no. -->

| slot | what | length | channels | pitched | licence |
|---|---|---|---|---|---|
| <slot> | <what to find, one line> | <0.2–1 s> | <mono> | <no> | <CC0 or CC-BY> |

## <slot>

- **Listen for:** <the quality that matters; what to reject (noise, reverb, other sounds)>
- **Why:** <what the patch does with it — e.g. grains read from its steady middle, so 2 s of
  even material matters more than the attack>
- **Pitch:** <n/a | the note to look for, or "any clear pitch; tell me which">
- **Search:** <Freesound terms; filters: licence CC0/Attribution, duration>
