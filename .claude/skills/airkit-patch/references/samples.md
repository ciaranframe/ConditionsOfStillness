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
  Avoid a slot that is another's prefix plus a hyphen (`bed` and `bed-low`): a file
  `bed-low-x.wav` then matches both.
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

- `length`, one of four forms (`parseLength`, `patching/tools/src/samples.ts`; the trailing `s`
  is optional): `≤ N s` → 0…N; `A–B s` (en dash or hyphen) → A…B; a bare `N s` → N×0.5…N×2;
  `any` → no limit. Give what the patch actually uses (a grain source needs a few seconds of
  steady material; a hit needs the attack and a short tail). A source outside the range is
  **still converted**, with a warning — the range guides the search, it does not reject.
- `channels`: `mono` or `stereo` — the channel count the converted file **will have**: a stereo
  source is downmixed to mono, a mono one up-mixed to stereo (ffmpeg `-ac`). **`mono` for
  anything read by `GrainBuf`/`TGrains`**, and for hits the patch pans itself; `stereo` only for
  beds whose width is the point.
- `pitched`: `yes` or `no`; `yes` when the patch transposes it musically — then say the pitch to look for (or
  that any clearly pitched note will do and the patch will be told its `srcFreq`).
- `licence`: CC0, CC-BY (attribution recorded in `SOURCES.md`), or Ciaran's own recording. No
  NC/ND licences, nothing without a stated licence.

Below the table, one short section per slot: what to listen for (and what to reject), the
target loudness character (peak-normalised is fine; the patch sets level), a sample-rate note
(any rate; the check converts to 48 kHz), and suggested search terms and places (Freesound
text with its licence filter set to CC0/Attribution, Ciaran's own field recordings). Then tell Ciaran, in the hand-off, that the patch will be silent in those
voices until the files exist, and stop.

## 3. Ciaran downloads

Into `samples/COS_<Name>/` (not into `wav/`, which the check never reads), a file per slot whose
basename **starts with `<slot>-`** or **is exactly `<slot>.<ext>`**, case-insensitive:
`drop-freesound-12345.wav`, `bed-tinroof.flac`, `Rim.aiff`. Audio extensions read: wav aif aiff
flac mp3 ogg m4a. When several files match a slot, the first in sorted order is used and the
rest are reported as extras. Audio files are gitignored (`samples/**/*.wav` etc.);
`SHOPPING.md`, `manifest.json` and `SOURCES.md` are committed.

## 4. `npm run samples:check -- COS_<Name>`

`patching/tools/samples-check.ts` (plan Task 7):

Usage `samples-check.ts COS_<Name> [--dir <samples root>]` (default root: the repo's `samples/`).

- parses `SHOPPING.md`'s table and matches files to slots as in §3 (no interactive assignment);
- probes each matched file (`ffprobe`); an unreadable one is reported for its slot;
- converts with `ffmpeg` to 48 kHz 24-bit WAV with the row's channel count (§2), into
  `samples/COS_<Name>/wav/<slot>.wav`, and notes `stereo→mono` / `mono→stereo` and
  `length out of range` on the slot's `[ok]` line;
- writes `manifest.json` atomically, for the slots that converted (even on a failing run):
  `{ "<slot>": { "file": "wav/<slot>.wav", "frames": …, "channels": 1|2, "sr": 48000, "source": "<original filename>", "seconds": … } }`;
- writes a `SOURCES.md` skeleton (`| slot | file | url | author | licence |`, file and licence
  filled) if none exists; an existing one is **never overwritten** — rows are appended only for
  converted slots it does not list yet. Ciaran completes url and author; the patch is not done
  until every row is filled.

Exit **0** every slot converted (length warnings allowed); **1** any slot missing or unreadable,
or any audio file that is an extra (matches no slot, or a second match for one) — whatever could
be converted still is, and the manifest lists those; **2** usage error or no `SHOPPING.md`. A
malformed table (wrong header, unknown length form, channels not mono/stereo, pitched not
yes/no) aborts with the reason. Re-run after fixing.

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
