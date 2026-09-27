#!/bin/bash
# Parse-check a personality in a throwaway headless sclang (~3 s), so a syntax error never
# reaches the live AirKit, which would hot-load it. Does not execute the patch. Exit 0 = parses.
#
# Copied from Glimmer's tools/patch-compile.sh (airkit-glimmer/tools/patch-compile.sh), credit
# there; env var renamed COS_CHECK_FILE and repointed at this repo's airkit/personalities/.
#
# Usage: patching/tools/patch-compile.sh <Name | path>   (a .tmp path is fine: check BEFORE the mv)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
F="$1"; [ -f "$F" ] || F="$HERE/airkit/personalities/$1.sc"
[ -f "$F" ] || { echo "patch-compile: no such file $1" >&2; exit 2; }
CHECK="$(mktemp -t coscheck).scd"
cat > "$CHECK" <<'SCD'
(
var fn = thisProcess.interpreter.compile(File.readAllString("COS_CHECK_FILE".getenv));
if (fn.isNil) { "COMPILECHECK: PARSE FAILED".postln } { "COMPILECHECK: OK".postln };
0.exit;
)
SCD
OUT="$(COS_CHECK_FILE="$F" /Applications/SuperCollider.app/Contents/MacOS/sclang -u 57190 "$CHECK" 2>&1 || true)"
rm -f "$CHECK"
if echo "$OUT" | grep -q "COMPILECHECK: OK"; then echo "$(basename "$F"): parses"; exit 0; fi
echo "$OUT" | grep -v "^\s*$" | grep -i -B2 -A8 "ERROR\|syntax\|unexpected\|PARSE FAILED" | head -40
exit 1
