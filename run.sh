#!/bin/bash
# Start the Conditions of Stillness engine (AirKit profile on branch AirConditions) under a
# restart loop. Sub-project 3 adds the runner here. Ctrl-C stops sclang and its scsynth.
#   COS_LANGPORT      sclang OSC port   (default 57120)
#   COS_SCSYNTH_PORT  scsynth port      (default 57110)
#   COS_OUT_DEVICE    output device name (default: CoreAudio default; e.g. "MacBook Pro Speakers")
#   COS_LIMITER       1 (default) | 0
#   COS_SAMPLES       samples folder    (default: ./samples)
set -uo pipefail
cd "$(dirname "$0")" || exit 1
SCLANG="/Applications/SuperCollider.app/Contents/MacOS/sclang"
PORT="${COS_LANGPORT:-57120}"
export COS_SCSYNTH_PORT="${COS_SCSYNTH_PORT:-57110}"
export COS_OUT_DEVICE="${COS_OUT_DEVICE:-}"
export COS_LIMITER="${COS_LIMITER:-1}"
export COS_SAMPLES="${COS_SAMPLES:-$PWD/samples}"
MAIN="airkit/code3.0/conditions/main_conditions.scd"
LOG="${COS_AIRKIT_LOG:-$HOME/.conditions/airkit.log}"

[ -x "$SCLANG" ] || { echo "run.sh: SuperCollider not found at $SCLANG" >&2; exit 1; }
[ -f "$MAIN" ] || { echo "run.sh: $MAIN missing — run ./setup.sh first" >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"
: > "$LOG"

# On Ctrl-C / TERM / exit: kill sclang (our child) and the scsynth it spawned (not our child).
# sclang runs in the background and is wait-ed on so the trap can fire between commands.
trap 'pkill -P $$ 2>/dev/null; pkill -f "scsynth -u $COS_SCSYNTH_PORT" 2>/dev/null; exit' INT TERM EXIT

echo "[engine] log: $LOG · langPort $PORT · scsynth $COS_SCSYNTH_PORT · samples $COS_SAMPLES"
while true; do
  if pgrep -f "scsynth -u $COS_SCSYNTH_PORT" >/dev/null; then
    echo "[engine] stale scsynth on $COS_SCSYNTH_PORT; killing it first"
    pkill -f "scsynth -u $COS_SCSYNTH_PORT"; sleep 1
  fi
  "$SCLANG" -u "$PORT" "$MAIN" > >(tee -a "$LOG") 2>&1 &
  wait "$!"
  echo "[engine] sclang exited ($?); restarting in 3 s"
  sleep 3
done
