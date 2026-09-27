# Samples

The shopping-list workflow (spec §8):

1. A patch's header declares `samples: [slotName: "what", …]`.
2. The skill writes `samples/COS_<Name>/SHOPPING.md` — per slot: what to find, length, mono/
   stereo, pitched or not, licence needed.
3. Ciaran downloads files into that folder under any filenames.
4. `npm run samples:check -- <Name>` matches files to slots by filename prefix `<slot>-`,
   converts to 48 kHz WAV, and writes `manifest.json` plus a `SOURCES.md` skeleton to complete.
5. The patch loads samples only through `topEnvironment[\cosSamples]`/`~cosSamples` and the slot
   name from the manifest — never a literal path; audio itself is gitignored.
