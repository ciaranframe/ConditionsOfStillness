# Patch Marks Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sibelius ManuScript plugin that adds and renumbers boxed `>PATCH>` / letter marks on one staff.

**Architecture:** One ManuScript source file kept in UTF-8 for editing, a tiny Python build script that emits the UTF-16 LE `.plg` Sibelius expects and copies it into the user plugins folder, and Python tests that mirror the pure logic (letter sequence) and check the built file's structure. Behaviour inside Sibelius is verified by a manual checklist because ManuScript cannot run outside Sibelius.

**Tech Stack:** ManuScript (Sibelius 2025.3), Python 3 + pytest for build and tests. No git repository in this project, so there are no commit steps.

**Spec:** `docs/superpowers/specs/2026-09-15-patch-marks-plugin-design.md`

## Global Constraints

- Target: Sibelius 2025.3 on macOS. Install path: `~/Library/Application Support/Avid/Sibelius/Plugins/Patch Marks/PatchMarks.plg`.
- `.plg` file encoding: UTF-16 LE with BOM (`FF FE`), matching existing plugins in that folder.
- Inside `.plg` method bodies use single-quoted strings only; a raw double quote would terminate the method body.
- Mark text: first line exactly `>PATCH>`, line break via the styled-string code `\n\` (written `'\\n\\'` in ManuScript source), second line the letter.
- Letter sequence: A..Z, AA, BB, .. ZZ, AAA, .. (1→A, 26→Z, 27→AA, 53→AAA).
- Text style: `Sibelius.FindStyleId('Patch Mark')` if non-empty, else `text.staff.boxed`.
- Recognition: any staff Text whose text starts with `>PATCH>`.
- ManuScript facts relied on: `for i = a to b` is exclusive of `b`; `Staff.NthBar(n)` and `Score.NthStaff(n)` are 1-based; `Bar.ParentStaff`, `Staff.IsSystemStaff`, `Selection.IsPassage/TopStaff/FirstBarNumber/FirstBarSr`, `SparseArray.Push/Length`, `Substring/Length/Chr/RoundDown`, `Score.Redraw`.

---

## File Structure

- `plugins/src/PatchMarks.plg` — ManuScript source, UTF-8, LF. The only file a human edits.
- `plugins/build_plg.py` — converts src → `plugins/dist/PatchMarks.plg` (UTF-16 LE BOM, CRLF) and, with `--install`, copies to the Sibelius plugins folder.
- `plugins/tests/test_patch_letter.py` — Python mirror of the letter algorithm, asserting the sequence.
- `plugins/tests/test_build.py` — builds the file and checks BOM, decodability, top-level structure, method names, no raw double quotes in bodies, balanced braces.
- `plugins/README.md` — install, shortcut binding, text style setup, usage.

---

### Task 1: Build script and structural test

**Files:**
- Create: `plugins/build_plg.py`
- Create: `plugins/tests/test_build.py`
- Create: `plugins/src/PatchMarks.plg` (minimal placeholder that Task 3 replaces)

**Interfaces:**
- Produces: `build_plg.build(src: Path, dist: Path) -> bytes` and `build_plg.install(dist: Path) -> Path`; CLI `python3 plugins/build_plg.py [--install]`.
- Produces: `parse_plg(text: str) -> dict[str, str]` in the test module (top-level entry name → value), reused by Task 3's test.

- [ ] **Step 1: Write the failing test**

`plugins/tests/test_build.py`:
```python
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "PatchMarks.plg"
DIST = ROOT / "dist" / "PatchMarks.plg"
sys.path.insert(0, str(ROOT))
import build_plg  # noqa: E402


def parse_plg(text: str) -> dict:
    """Parse the outer { Name "value" ... } structure. Values may span lines.
    Backslash escapes inside values are kept verbatim."""
    assert text.lstrip().startswith("{") and text.rstrip().endswith("}")
    body = text.strip()[1:-1]
    entries = {}
    i = 0
    n = len(body)
    while i < n:
        m = re.compile(r'\s*([A-Za-z_][A-Za-z0-9_]*)\s*"').match(body, i)
        if not m:
            assert body[i:].strip() == "", f"junk at {body[i:i+40]!r}"
            break
        name = m.group(1)
        j = m.end()
        val = []
        while j < n:
            c = body[j]
            if c == "\\" and j + 1 < n:
                val.append(body[j:j+2]); j += 2; continue
            if c == '"':
                break
            val.append(c); j += 1
        entries[name] = "".join(val)
        i = j + 1
    return entries


def built_text() -> str:
    data = build_plg.build(SRC, DIST)
    assert data[:2] == b"\xff\xfe", "missing UTF-16 LE BOM"
    return data[2:].decode("utf-16-le")


def test_build_emits_utf16_with_crlf_entries():
    text = built_text()
    assert "\r\n" in text
    assert "﻿" not in text  # BOM only once, as raw bytes


def test_structure_parses_and_has_initialize():
    entries = parse_plg(built_text())
    assert "Initialize" in entries
    assert entries["Initialize"].startswith("()")


def test_method_bodies_have_balanced_braces():
    for name, val in parse_plg(built_text()).items():
        if val.startswith("("):
            assert val.count("{") == val.count("}"), name


def test_cli_builds_file(tmp_path):
    out = subprocess.run([sys.executable, str(ROOT / "build_plg.py")],
                         capture_output=True, text=True)
    assert out.returncode == 0, out.stderr
    assert DIST.exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ciaran/Documents/ConditionsOfStillness && python3 -m pytest plugins/tests/test_build.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'build_plg'` (install pytest first if missing: `python3 -m pip install --user pytest`).

- [ ] **Step 3: Write the placeholder source and the build script**

`plugins/src/PatchMarks.plg` (placeholder, replaced in Task 3):
```
{
	Initialize "() {
AddToPluginsMenu('Add Patch Mark', 'AddPatchMark');
}"
	AddPatchMark "() {
Sibelius.MessageBox('placeholder');
}"
}
```

`plugins/build_plg.py`:
```python
#!/usr/bin/env python3
"""Build PatchMarks.plg for Sibelius.

Reads the UTF-8 source, writes a UTF-16 LE (with BOM) copy with CRLF line
endings, which is what Sibelius' own plugin files use, and optionally installs
it into the user's Sibelius plugins folder.
"""
import argparse, shutil, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src" / "PatchMarks.plg"
DIST = HERE / "dist" / "PatchMarks.plg"
INSTALL_DIR = Path.home() / "Library/Application Support/Avid/Sibelius/Plugins/Patch Marks"


def build(src: Path = SRC, dist: Path = DIST) -> bytes:
    text = src.read_text(encoding="utf-8")
    if '"' in text:
        # Double quotes delimit entries; a raw one inside a body corrupts the file.
        # Entry delimiters are the only legal ones, so count must be even.
        assert text.count('"') % 2 == 0, "unbalanced double quotes in source"
    text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    data = b"\xff\xfe" + text.encode("utf-16-le")
    dist.parent.mkdir(parents=True, exist_ok=True)
    dist.write_bytes(data)
    return data


def install(dist: Path = DIST) -> Path:
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    target = INSTALL_DIR / dist.name
    shutil.copyfile(dist, target)
    return target


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--install", action="store_true", help="copy into the Sibelius plugins folder")
    args = ap.parse_args(argv)
    build()
    print(f"built {DIST}")
    if args.install:
        print(f"installed {install()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/ciaran/Documents/ConditionsOfStillness && python3 -m pytest plugins/tests/test_build.py -q`
Expected: 4 passed.

---

### Task 2: Letter sequence

**Files:**
- Create: `plugins/tests/test_patch_letter.py`
- Modify: `plugins/src/PatchMarks.plg` (add `PatchLetter` method)

**Interfaces:**
- Produces (ManuScript): `PatchLetter(n)` → string, n ≥ 1.
- Produces (Python mirror, test-only): `patch_letter(n: int) -> str`, same algorithm, kept in the test file.

- [ ] **Step 1: Write the failing test**

`plugins/tests/test_patch_letter.py`:
```python
import re
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "PatchMarks.plg"


def patch_letter(n: int) -> str:
    """Python mirror of the ManuScript PatchLetter(n). Keep the two in step."""
    cycle = (n - 1) // 26
    idx = (n - 1) - 26 * cycle
    return chr(65 + idx) * (cycle + 1)


def test_sequence_matches_sibelius_default():
    assert [patch_letter(i) for i in range(1, 6)] == ["A", "B", "C", "D", "E"]
    assert patch_letter(26) == "Z"
    assert patch_letter(27) == "AA"
    assert patch_letter(28) == "BB"
    assert patch_letter(52) == "ZZ"
    assert patch_letter(53) == "AAA"


def test_manuscript_source_defines_patch_letter_with_same_shape():
    text = SRC.read_text(encoding="utf-8")
    m = re.search(r'PatchLetter "\(n\) \{(.*?)\}"\s*$', text, re.S | re.M)
    assert m, "PatchLetter(n) method missing"
    body = m.group(1)
    for token in ["RoundDown((n - 1) / 26)", "Chr(65 + idx)", "cycle + 1"]:
        assert token in body, token
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest plugins/tests/test_patch_letter.py -q`
Expected: first test passes (pure Python), second FAILS with "PatchLetter(n) method missing".

- [ ] **Step 3: Add the ManuScript method**

Insert before the final `}` of `plugins/src/PatchMarks.plg`:
```
	PatchLetter "(n) {
// 1 -> A, 26 -> Z, 27 -> AA, 53 -> AAA: same sequence as Sibelius rehearsal marks.
cycle = RoundDown((n - 1) / 26);
idx = (n - 1) - (26 * cycle);
letter = Chr(65 + idx);
result = '';
for i = 0 to cycle + 1 {
	result = result & letter;
}
return result;
}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest plugins/tests -q`
Expected: all passed (build tests still pass with the added method).

---

### Task 3: Commands, helpers, install, README

**Files:**
- Modify: `plugins/src/PatchMarks.plg` (full plugin)
- Modify: `plugins/tests/test_build.py` (add method-name and quoting assertions)
- Create: `plugins/README.md`

**Interfaces:**
- Consumes: `PatchLetter(n)` from Task 2; `build`/`install` from Task 1.
- Produces (ManuScript methods): `Initialize()`, `AddPatchMark()`, `RenumberPatchMarks()`, `GetScore()`, `GetTarget(score)`, `FindPatchMarkAt(bar, pos)`, `IsPatchMark(t)`, `GetStyleId()`, `RenumberStaff(staff)`.

- [ ] **Step 1: Write the failing test**

Append to `plugins/tests/test_build.py`:
```python
REQUIRED_METHODS = ["Initialize", "AddPatchMark", "RenumberPatchMarks", "GetScore",
                    "GetTarget", "FindPatchMarkAt", "IsPatchMark", "GetStyleId",
                    "RenumberStaff", "PatchLetter"]


def test_all_methods_present_and_menu_registered():
    entries = parse_plg(built_text())
    for m in REQUIRED_METHODS:
        assert m in entries and entries[m].startswith("("), m
    init = entries["Initialize"]
    assert "AddToPluginsMenu('Add Patch Mark', 'AddPatchMark')" in init
    assert "AddToPluginsMenu('Renumber Patch Marks', 'RenumberPatchMarks')" in init


def test_prefix_and_linebreak_code():
    entries = parse_plg(built_text())
    assert entries["_Prefix"] == ">PATCH>"
    # ManuScript source '\\n\\' arrives in the file as the four characters \ \ n \ \
    assert "'\\\\n\\\\'" in entries["AddPatchMark"]
    assert "'\\\\n\\\\'" in entries["RenumberStaff"]


def test_no_raw_double_quote_inside_method_bodies():
    src = SRC.read_text(encoding="utf-8")
    # every " must be an entry delimiter: strip them and no others remain
    bodies = re.findall(r'"\((.*?)\}"', src, re.S)
    for b in bodies:
        assert '"' not in b
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest plugins/tests -q`
Expected: the three new tests FAIL (missing methods, missing `_Prefix`).

- [ ] **Step 3: Write the full plugin source**

Replace `plugins/src/PatchMarks.plg` entirely with:
```
{
	Initialize "() {
AddToPluginsMenu('Add Patch Mark', 'AddPatchMark');
AddToPluginsMenu('Renumber Patch Marks', 'RenumberPatchMarks');
}"
	_PluginName "Patch Marks"
	_Version "1.0.0"
	_Prefix ">PATCH>"
	_StyleName "Patch Mark"
	_FallbackStyleId "text.staff.boxed"
	_KeyScale "1000000"
	_MsgNoScore "No score is open."
	_MsgNoSelection "Select a note, rest or bar on the staff that should carry the patch mark, then run Add Patch Mark again."
	_MsgSystemStaff "Patch marks are staff text and cannot go on the system staff. Select something on a normal staff."
	_MsgExists "There is already a patch mark at that position. The marks on this staff have been renumbered instead."
	_MsgRenumbered "Renumbered patch marks on this staff: "
	_MsgNone "No patch marks found on the selected staff."
	AddPatchMark "() {
// Adds a boxed '>PATCH>' + letter staff text at the selection, then renumbers
// every patch mark on that staff so letters run A, B, C ... in score order.
score = GetScore();
if (not IsObject(score)) {
	return False;
}
target = GetTarget(score);
if (target.Length = 0) {
	return False;
}
staff = target[0];
bar = target[1];
pos = target[2];
existing = FindPatchMarkAt(bar, pos);
if (IsObject(existing)) {
	score.Redraw = False;
	RenumberStaff(staff);
	score.Redraw = True;
	Sibelius.MessageBox(_MsgExists);
	return True;
}
score.Redraw = False;
bar.AddText(pos, _Prefix & '\\n\\' & 'A', GetStyleId());
RenumberStaff(staff);
score.Redraw = True;
return True;
}"
	RenumberPatchMarks "() {
// Re-letters all patch marks on the selected staff in score order.
score = GetScore();
if (not IsObject(score)) {
	return False;
}
target = GetTarget(score);
if (target.Length = 0) {
	return False;
}
staff = target[0];
score.Redraw = False;
count = RenumberStaff(staff);
score.Redraw = True;
if (count = 0) {
	Sibelius.MessageBox(_MsgNone);
} else {
	Sibelius.MessageBox(_MsgRenumbered & count);
}
return True;
}"
	GetScore "() {
// Returns the active score, or False (with a message) if none is open.
if (Sibelius.ScoreCount = 0) {
	Sibelius.MessageBox(_MsgNoScore);
	return False;
}
return Sibelius.ActiveScore;
}"
	GetTarget "(score) {
// Works out where a mark should go from the current selection.
// Returns a sparse array [staff, bar, position], or an empty array after showing a message.
sel = score.Selection;
empty = CreateSparseArray();
if (sel.IsPassage) {
	if (sel.IsSystemPassage) {
		Sibelius.MessageBox(_MsgSystemStaff);
		return empty;
	}
	staff = score.NthStaff(sel.TopStaff);
	if (staff.IsSystemStaff) {
		Sibelius.MessageBox(_MsgSystemStaff);
		return empty;
	}
	bar = staff.NthBar(sel.FirstBarNumber);
	result = CreateSparseArray();
	result.Push(staff, bar, sel.FirstBarSr);
	return result;
}
// Non-passage selection (one or more clicked objects): use the earliest one.
bestObj = False;
bestKey = -1;
sawSystemObject = False;
for each obj in sel {
	if (IsObject(obj)) {
		objBar = obj.ParentBar;
		objStaff = objBar.ParentStaff;
		if (objStaff.IsSystemStaff) {
			sawSystemObject = True;
		} else {
			key = (objBar.BarNumber * (0 + _KeyScale)) + obj.Position;
			if ((bestKey < 0) or (key < bestKey)) {
				bestKey = key;
				bestObj = obj;
			}
		}
	}
}
if (not IsObject(bestObj)) {
	if (sawSystemObject) {
		Sibelius.MessageBox(_MsgSystemStaff);
	} else {
		Sibelius.MessageBox(_MsgNoSelection);
	}
	return empty;
}
bar = bestObj.ParentBar;
result = CreateSparseArray();
result.Push(bar.ParentStaff, bar, bestObj.Position);
return result;
}"
	FindPatchMarkAt "(bar, pos) {
// Returns the patch mark Text at exactly this bar and position, or False.
for each Text t in bar {
	if (t.Position = pos) {
		if (IsPatchMark(t)) {
			return t;
		}
	}
}
return False;
}"
	IsPatchMark "(t) {
// A patch mark is any staff text whose text starts with the prefix.
return (Substring(t.Text, 0, Length(_Prefix)) = _Prefix);
}"
	GetStyleId "() {
// Prefer a user-defined 'Patch Mark' text style; fall back to built-in Boxed text.
id = Sibelius.FindStyleId(_StyleName);
if (id = '') {
	id = _FallbackStyleId;
}
return id;
}"
	RenumberStaff "(staff) {
// Collects every patch mark on the staff, sorts by (bar, position), rewrites
// the letters. Returns the number of marks renumbered.
keys = CreateSparseArray();
marks = CreateSparseArray();
barCount = staff.BarCount;
for i = 1 to barCount + 1 {
	bar = staff.NthBar(i);
	for each Text t in bar {
		if (IsPatchMark(t)) {
			keys.Push((i * (0 + _KeyScale)) + t.Position);
			marks.Push(t);
		}
	}
}
// Insertion sort on keys, moving marks in step (for-each order within a bar is not guaranteed).
n = keys.Length;
for i = 1 to n {
	j = i;
	while (j > 0) {
		if (keys[j - 1] > keys[j]) {
			tmpKey = keys[j - 1];
			keys[j - 1] = keys[j];
			keys[j] = tmpKey;
			tmpMark = marks[j - 1];
			marks[j - 1] = marks[j];
			marks[j] = tmpMark;
			j = j - 1;
		} else {
			j = 0;
		}
	}
}
for i = 0 to n {
	mark = marks[i];
	mark.Text = _Prefix & '\\n\\' & PatchLetter(i + 1);
}
return n;
}"
	PatchLetter "(n) {
// 1 -> A, 26 -> Z, 27 -> AA, 53 -> AAA: same sequence as Sibelius rehearsal marks.
cycle = RoundDown((n - 1) / 26);
idx = (n - 1) - (26 * cycle);
letter = Chr(65 + idx);
result = '';
for i = 0 to cycle + 1 {
	result = result & letter;
}
return result;
}"
}
```

Notes for the implementer:
- `_KeyScale` is stored as a string entry (all top-level data entries are strings); `0 + _KeyScale` coerces it to a number, the idiom used by shipped plugins.
- `for i = a to b` in ManuScript stops before `b`, hence `barCount + 1` and `cycle + 1`.
- The insertion sort avoids `and` short-circuit assumptions by nesting the bounds check.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest plugins/tests -q`
Expected: all passed.

- [ ] **Step 5: Build and install**

Run: `python3 plugins/build_plg.py --install && xxd "$HOME/Library/Application Support/Avid/Sibelius/Plugins/Patch Marks/PatchMarks.plg" | head -2`
Expected: prints the built and installed paths; hex dump starts `fffe`.

- [ ] **Step 6: Write the README**

`plugins/README.md`:
```markdown
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
```

---

### Task 4: Manual verification in Sibelius (user-run)

**Files:** none. Uses a copy of `scores/score1.sib`.

- [ ] **Step 1: Duplicate the score**

Run: `cp scores/score1.sib scores/score1-patchmarks-test.sib` and open the copy in Sibelius.

- [ ] **Step 2: Reload plugins**

Plug-ins > Edit Plug-ins > Reload. Confirm Plug-ins > Patch Marks shows both commands.

- [ ] **Step 3: Work the checklist and record results**

| # | Action | Expected |
|---|--------|----------|
| 1 | Select a note on the AirSticks staff, Add | Boxed two-line `>PATCH>` / `A` above the note |
| 2 | Add at two later points | B, C |
| 3 | Add between A and B | Letters read A, B, C, D in score order |
| 4 | Cut mark C, paste after D, Renumber | Re-lettered in new order |
| 5 | Delete B, Renumber | Gap closed |
| 6 | Open another instrument's part | No patch marks; ordinary rehearsal marks intact |
| 7 | Open the AirSticks part | Marks present |
| 8 | Add with nothing selected; Add with system staff selected | Message box, no change |
| 9 | Add a 27th mark | Reads AA |
| 10 | Undo (Cmd+Z) after Add | Mark removed |

- [ ] **Step 4: Report**

Paste any message box text or Plug-in Trace Window errors back into the session. If step 1 shows `>PATCH>\n\A` literally, the line-break code needs changing; if it shows on one line, report that too.
