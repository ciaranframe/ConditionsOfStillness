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
