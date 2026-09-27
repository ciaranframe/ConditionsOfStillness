# Samples

The shopping-list workflow (spec §8):

1. A patch's header declares `samples: [slotName: "what", …]`.
2. The skill writes `samples/COS_<Name>/SHOPPING.md` — a table with exactly these columns, in
   this order: `| slot | what | length | channels | pitched | licence |` (`length` one of
   `≤ 1 s`, `4–10 s`, `2 s`, `any`; `channels` `mono`/`stereo`; `pitched` `yes`/`no`; `licence`
   free text, e.g. `CC0`, `CC-BY`, `own recording`).
3. Ciaran downloads files into that folder under any filenames; a file belongs to slot `s` when
   its basename starts with `s-` or equals `s.<ext>`.
4. `npm run samples:check -- COS_<Name>` matches files to slots, converts to 48 kHz WAV, and
   writes `manifest.json` plus a `SOURCES.md` skeleton to complete.
5. The patch loads samples only through `topEnvironment[\cosSamples]`/`~cosSamples` and the slot
   name from the manifest — never a literal path; audio itself is gitignored.
