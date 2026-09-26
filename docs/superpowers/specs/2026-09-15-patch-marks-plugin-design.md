# Patch Marks plugin for Sibelius — design

Date: 2026-09-15
Target: Sibelius 2025.3 (ManuScript), macOS
Status: approved in conversation, pending build

## Purpose

*Conditions of Stillness* uses an AirSticks performer whose interface advances
through numbered "patches" via a button press. The score needs a second kind
of rehearsal-mark-like figure, a **patch mark**, that:

- appears only on the AirSticks staff (in its part, and above that staff in the
  full score), never in the other parts;
- shows `>PATCH>` on the first line and a letter on the second, inside a box;
- letters ascend in score order: A–Z, then AA, BB, CC … ZZ, then AAA …
  (Sibelius' default rehearsal-mark sequence);
- can be moved, edited, hidden and deleted like ordinary text;
- does not interfere with the score's ordinary rehearsal marks, which are also
  in use.

## Constraints discovered

- Sibelius text-style borders are solid box or circle only. A dotted border is
  impossible on a text object. **Decision: solid box, single text object.**
- Ordinary rehearsal marks are system objects, appear in every part, and share
  one letter sequence. They cannot be reused for this.
- ManuScript has no event hooks. A plugin cannot react to the user moving or
  deleting objects. **Decision: renumbering runs automatically on Add, and on
  demand via a Renumber command bound to a shortcut.**
- ManuScript cannot create text styles. **Decision: use a user-made staff text
  style named `Patch Mark` if present, else fall back to the built-in
  `text.staff.boxed` style.**

## Deliverable

One plugin file, `PatchMarks.plg`, kept in the project at `plugins/` and
installed at
`~/Library/Application Support/Avid/Sibelius/Plugins/Patch Marks/PatchMarks.plg`
(the folder name becomes the Plug-ins menu category). UTF-16 LE with BOM,
matching the existing plugins in that folder.

### Commands (Plug-ins > Patch Marks)

1. **Add Patch Mark**
   - Requires an open score and a selection on a normal (non-system) staff.
   - Target staff = `Selection.TopStaff`. Target bar and rhythmic position =
     bar and `Position` of the earliest selected bar object; for a bar/passage
     selection with no objects, the first selected bar at position 0.
   - If a patch mark already exists on that staff at that bar and position,
     do not add another; renumber and report.
   - Otherwise `bar.AddText(pos, ">PATCH>" + newline + "A", style)` where style
     is the `Patch Mark` style id if the score has one, else `text.staff.boxed`.
   - Then run the renumber pass on that staff so the new mark and its
     neighbours get correct letters.
2. **Renumber Patch Marks**
   - Requires an open score and a selection on a normal staff (used only to
     pick the staff).
   - Collect every `Text` object on the staff whose first line is exactly
     `>PATCH>`, in bar-then-position order (iteration over bars and bar
     objects is already in score order).
   - Rewrite each one's `Text` to `>PATCH>` + newline + letter(n).
   - Report how many marks were numbered.

### Letter sequence

`letter(n)` for n = 1, 2, 3 …: cycle = (n-1) div 26, index = (n-1) mod 26;
result is the letter at `index` repeated `cycle + 1` times. So 1→A, 26→Z,
27→AA, 28→BB, 53→AAA.

### Recognition rule

A patch mark is any staff `Text` whose text starts with `>PATCH>` followed by
a line break (or is exactly `>PATCH>`). Style is not used for recognition, so
the user can restyle marks freely.

### Error handling

Message boxes, no changes made, for: no open score; empty selection; selection
on the system staff; staff has no bars. Any unexpected condition inside the
loop is guarded with bounds checks (never call `NthBar` beyond `BarCount`).

### Out of scope

- Dotted borders (impossible on text).
- Automatic renumbering on drag/cut/paste (no event hooks).
- Multi-staff renumbering in one run; the command works on the selected staff.
- Playback or OSC output. The AirSticks OSC recorder is a separate project.

## Testing (manual, in Sibelius)

Run on a *copy* of `scores/score1.sib`:

1. Install file, Plug-ins > Edit Plug-ins > Reload (or restart). Both commands
   appear under Plug-ins > Patch Marks.
2. Select a note on the AirSticks staff, run Add. A boxed two-line mark
   `>PATCH>` / `A` appears above that note.
3. Add two more later in the staff: B, C. Add one between A and B: letters
   become A, B, C, D in score order.
4. Cut/paste C to after D, run Renumber: order re-lettered.
5. Delete B, run Renumber: remaining marks close the gap.
6. Open another instrument's part: no patch marks. Open the AirSticks part:
   marks present. Ordinary rehearsal marks unaffected.
7. Add with nothing selected, and with the system staff selected: message
   box, no change.
8. Add 27 marks: 27th reads AA.

Open question to verify in step 2: whether `\n` in the ManuScript string
produces a line break in the created text. If not, try the alternative
encodings before falling back to single-line `>PATCH> A`.
