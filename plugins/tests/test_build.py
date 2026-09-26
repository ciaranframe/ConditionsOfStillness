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
