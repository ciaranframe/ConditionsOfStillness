#!/bin/bash
# Start the Conditions of Stillness engine (AirKit profile on branch AirConditions) and the show
# runner (runner/src/main.ts), each under its own restart loop. Ctrl-C stops both, and scsynth.
#   COS_LANGPORT      sclang OSC port   (default 57120; the runner sends to it)
#   COS_SCSYNTH_PORT  scsynth port      (default 57110)
#   COS_OUT_DEVICE    output device name (default: CoreAudio default; e.g. "MacBook Pro Speakers")
#   COS_LIMITER       1 (default) | 0
#   COS_SAMPLES       samples folder    (default: ./samples)
# The runner also reads COS_STICK_PORT, COS_WEB_PORT, COS_SOURCE_PORT, COS_AIRKIT_HOST,
# COS_STATE_PATH (defaults from scenes/cast.yaml's network: section).
set -uo pipefail
cd "$(dirname "$0")" || exit 1
SCLANG="/Applications/SuperCollider.app/Contents/MacOS/sclang"
PORT="${COS_LANGPORT:-57120}"
export COS_LANGPORT="$PORT"
export COS_SCSYNTH_PORT="${COS_SCSYNTH_PORT:-57110}"
export COS_OUT_DEVICE="${COS_OUT_DEVICE:-}"
export COS_LIMITER="${COS_LIMITER:-1}"
export COS_SAMPLES="${COS_SAMPLES:-$PWD/samples}"
MAIN="airkit/code3.0/conditions/main_conditions.scd"
LOG="${COS_AIRKIT_LOG:-$HOME/.conditions/airkit.log}"
RUNNER_LOG="${COS_RUNNER_LOG:-$HOME/.conditions/runner.log}"

[ -x "$SCLANG" ] || { echo "run.sh: SuperCollider not found at $SCLANG" >&2; exit 1; }
[ -f "$MAIN" ] || { echo "run.sh: $MAIN missing — run ./setup.sh first" >&2; exit 1; }
command -v node >/dev/null || { echo "run.sh: node not found — install Node ≥ 22.18" >&2; exit 1; }
[ -d runner/node_modules ] || { echo "run.sh: runner/node_modules missing — run ./setup.sh first" >&2; exit 1; }
mkdir -p "$(dirname "$LOG")" "$(dirname "$RUNNER_LOG")"
[ -f "$LOG" ] && mv -f "$LOG" "$LOG.1"
[ -f "$RUNNER_LOG" ] && mv -f "$RUNNER_LOG" "$RUNNER_LOG.1"

# On Ctrl-C / TERM / exit: kill both loops and everything under them (sclang, node, tee), then the
# scsynth sclang spawned (not our descendant). Each loop runs in the background and is wait-ed on
# so the trap can fire between commands. A loop is killed before its children so it cannot restart them.
kill_tree() {
  local kids; kids=$(pgrep -P "$1")
  [ "$1" != "$$" ] && kill "$1" 2>/dev/null
  for k in $kids; do kill_tree "$k"; done
}
trap 'kill_tree $$; pkill -f "scsynth -u $COS_SCSYNTH_PORT" 2>/dev/null; exit' INT TERM EXIT

engine_loop() {
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
}

runner_loop() {
  while true; do
    node runner/src/main.ts > >(tee -a "$RUNNER_LOG") 2>&1 &
    wait "$!"
    echo "[runner] exited ($?); restarting in 3 s"
    sleep 3
  done
}

echo "[run] logs: engine $LOG · runner $RUNNER_LOG"
echo "[engine] langPort $PORT · scsynth $COS_SCSYNTH_PORT · samples $COS_SAMPLES"
engine_loop &
runner_loop &
wait
