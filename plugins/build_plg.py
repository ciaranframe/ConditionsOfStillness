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
