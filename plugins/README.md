# Patch Marks (Sibelius plugin)

Adds a second kind of rehearsal-mark-like figure for the AirSticks part:
boxed staff text reading `>PATCH>` over a letter. Marks live on one staff, so
they show only in that part (and above that staff in the full score), and
never disturb ordinary rehearsal marks.

## Install
1. `python3 plugins/build_plg.py --install`
2. In Sibelius: Plug-ins tab > Edit Plug-ins > Reload (or restart Sibelius).
3. Both commands appear under Plug-ins > Patch Marks.

## Shortcuts
File > Preferences > Keyboard Shortcuts > tab "Plug-ins" > find
"Add Patch Mark" and "Renumber Patch Marks" > Add.

## Text style (optional but recommended)
Text tab > Styles dialog launcher > New > based on "Boxed text" > name it
`Patch Mark`, set font/size to match Rehearsal marks. The plugin uses it when
present; otherwise it uses Boxed text.

## Use
- Select a note, rest, or bar on the AirSticks staff and run Add Patch Mark.
  All marks on that staff are re-lettered A, B, C ... in score order.
- After dragging, cutting/pasting, or deleting marks, select anything on that
  staff and run Renumber Patch Marks.
- Letters go A..Z, AA, BB, .. ZZ, AAA (Sibelius' default sequence).

## Limits
- Sibelius text borders are solid only; a dotted box is not possible.
- Plugins cannot react to edits, so renumbering after moves is one keypress.

## Development
- Source: `plugins/src/PatchMarks.plg` (UTF-8). Built file: `plugins/dist/`.
- Tests: `python3 -m pytest plugins/tests -q`
