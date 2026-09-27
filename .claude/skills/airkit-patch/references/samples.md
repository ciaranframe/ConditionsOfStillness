# Samples — the shopping-list workflow, from the skill's side

Synthesis first: a synthesised patch needs no assets and runs anywhere. Use samples only when the
research says synthesis cannot carry the referent (a specific recorded material, a voice, a
real instrument's attack). Then the skill never downloads anything itself: it writes a shopping
list, Ciaran fetches the files, a tool checks and converts them, and the patch loads them by
slot name. (Spec §8; plan ruling 7.)

## 1. Declare the slots in the header

```
samples:     [drop: "single water drop on glass, dry", bed: "distant rain on a tin roof"]
```

- One entry per buffer the patch reads; `none` when it reads none (lint checks the ten header
  keys, `header.keys`).
- Slot names are short lowercase words (`drop`, `bed`, `rim`): they become the filename prefix
  Ciaran uses and the converted file name `wav/<slot>.wav`. Never rename a slot once files exist.
- The header, `SHOPPING.md`, `manifest.json` and the patch must agree on the slot list.

## 2. Write `samples/COS_<Name>/SHOPPING.md`

From `assets/shopping-template.md`. The table is **machine-read** by `samples-check.ts`; keep the
header row exactly:

```
| slot | what | length | channels | pitched | licence |
|---|---|---|---|---|---|
| drop | a single water drop on glass, dry, close-miked | 0.2–1 s | mono | no | CC0 or CC-BY |
| bed | distant steady rain on a tin roof, no thunder or voices | 20–60 s | stereo | no | CC0 or CC-BY |
```

- `length`: a range `min–max s` or a bound `≤ N s` — what the patch actually uses (a grain
  source needs a few seconds of steady material; a hit needs the attack and a short tail).
- `channels`: `mono` or `stereo`. **`mono` for anything read by `GrainBuf`/`TGrains`**, and for
  hits that the patch pans itself; `stereo` only for beds whose width is the point.
- `pitched`: `yes` when the patch transposes it musically — then say the pitch to look for (or
  that any clearly pitched note will do and the patch will be told its `srcFreq`).
- `licence`: CC0, CC-BY (attribution recorded in `SOURCES.md`), or Ciaran's own recording. No
  NC/ND licences, nothing without a stated licence.

Below the table, one short section per slot: what to listen for (and what to reject), the
target loudness character (peak-normalised is fine; the patch sets level), a sample-rate note
(any rate; the check converts to 48 kHz), and suggested search terms and places (Freesound
text with its licence filter set to CC0/Attribution, Ciaran's own field recordings). Then tell Ciaran, in the hand-off, that the patch will be silent in those
voices until the files exist, and stop.

## 3. Ciaran downloads

Into `samples/COS_<Name>/`, under any names **prefixed by the slot**: `drop-freesound-12345.wav`,
`bed-tinroof.flac`. Audio files are gitignored (`samples/**/*.wav` etc.); `SHOPPING.md`,
`manifest.json` and `SOURCES.md` are committed.

## 4. `npm run samples:check -- COS_<Name>`

`patching/tools/samples-check.ts` (plan Task 7):

- parses `SHOPPING.md`, matches files to slots by the `<slot>-` prefix (no interactive
  assignment: anything unmatched is printed and the run exits 1);
- probes each file (`ffprobe`), reports unreadable or wrong-format files per file, checks length
  and channels against the row;
- converts with `ffmpeg` to 48 kHz 24-bit WAV, mono when the slot says mono, into
  `samples/COS_<Name>/wav/<slot>.wav`;
- writes `manifest.json` atomically:
  `{ "<slot>": { "file": "wav/<slot>.wav", "frames": …, "channels": …, "sr": 48000, "source": "<original filename>" } }`;
- writes a `SOURCES.md` skeleton (one row per slot: file, URL, author, licence) for Ciaran to
  complete — the patch is not done until every row is filled.

Exit 0 all slots satisfied, 1 anything missing or wrong (with the reasons). Re-run after fixing.

## 5. Load in the patch

Only through the engine's samples root, `topEnvironment[\cosSamples]` (set by `config.scd` from
`COS_SAMPLES`; `run.sh` points it at the repo's `samples/`). Build the path from it in the same
expression or one assignment away — lint `sample.manifest` traces exactly that, and
`banned.abs-path` rejects `"/Users/…"` and `"~/…"` literals.

```supercollider
var bufs, loading = false;
var slots = [\drop, \bed];
~init = ~init <> { |d|
    var dir = topEnvironment[\cosSamples] +/+ "COS_Name" +/+ "wav";
    loading = true;
    bufs = slots.collect { |k| Buffer.readChannel(s, dir +/+ (k ++ ".wav"), channels: [0]) };
    s.sync;
    if (loading) { /* name short reads, then build voices */ };
    d
};
```

- Read in `~init` (a Routine: `s.sync` is legal there, never in a tick). Guard with `loading`
  (`patterns.md` §3); build nothing that addresses a buffer before the barrier.
- A missing file is not an error, it is silence: check `numFrames` and post the slot name.
- `manifest.json` is available if the patch needs frames/channels:
  `(dir.dirname +/+ "manifest.json").parseJSONFile` (String keys).
- Free buffers last in `~deinit`, after the voices' release tail.
- Keep a patch's folder small (a few MB): `~/Documents` is cloud-synced.
