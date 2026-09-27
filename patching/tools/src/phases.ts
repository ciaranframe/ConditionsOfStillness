// Audition phases and take replay (pure). Task 5.
//
// Defines the gesture phases the audition tool (Task 6) plays into the engine's `~model` —
// synthetic ones (rest/tilt/sway/shake/strike/still/settle) built from the physical facts in
// the plan (sticks report acceleration in m/s^2 including gravity, rest = [0,0,-9.8] in the
// fake sticks' convention; a unit quaternion [qx,qy,qz,qw], identity [0,0,0,1]) — and a parser
// that turns a recorded take (Task 4's take.jsonl: header `{label,wrist,id,startedAt,hz}`, rows
// `{t,a:[ax,ay,az],q:[qx,qy,qz,qw]}` with t in ms from the first packet) into replay phases.
//
// No I/O, no timers: pose(t) is a pure function of t (seconds from the phase's own start).

export type Pose = { a: [number, number, number]; q: [number, number, number, number] };
export type PhaseName = 'rest' | 'tilt' | 'sway' | 'shake' | 'strike' | 'still' | 'settle' | 'take';
export interface Phase {
  name: PhaseName;
  seconds: number;
  /** t in seconds from the phase's own start (not the take/timeline start). */
  pose: (t: number) => Pose;
  label?: string;
  /** Played with the audition monitor at level 0 (heard nothing), then back to 1: the patch runs
   * preloaded-but-unheard, as on a standby slot (Task 6's `--long`). */
  preload?: boolean;
}

const GRAVITY = 9.8;
const REST_A: [number, number, number] = [0, 0, -GRAVITY];
const REST_Q: [number, number, number, number] = [0, 0, 0, 1];

function restPose(): Pose {
  return { a: [...REST_A], q: [...REST_Q] };
}

// --- synthetic phase builders ------------------------------------------------------------------

function restPhase(seconds: number): Phase {
  return { name: 'rest', seconds, pose: () => restPose() };
}

// Rotate about x by theta(t), ramping linearly from 0 to `degrees` over `rampSeconds`, then
// holding. Gravity in the rotated sensor frame is [0, 9.8*sin(theta), -9.8*cos(theta)] (theta=0
// reproduces rest's [0,0,-9.8]); q = [sin(theta/2), 0, 0, cos(theta/2)].
function tiltPhase(seconds: number, degrees = 40, rampSeconds = 2): Phase {
  const thetaMax = (degrees * Math.PI) / 180;
  const ramp = Math.min(rampSeconds, seconds);
  return {
    name: 'tilt',
    seconds,
    pose: (t: number) => {
      const clamped = Math.min(Math.max(t, 0), ramp);
      const theta = ramp > 0 ? thetaMax * (clamped / ramp) : thetaMax;
      const half = theta / 2;
      return {
        a: [0, GRAVITY * Math.sin(theta), -GRAVITY * Math.cos(theta)],
        q: [Math.sin(half), 0, 0, Math.cos(half)],
      };
    },
  };
}

// Sinusoidal sway on z only, no rotation: amplitude `amp` at `hz`.
function swayPhase(seconds: number, hz = 0.5, amp = 3): Phase {
  return {
    name: 'sway',
    seconds,
    pose: (t: number) => ({
      a: [0, 0, -GRAVITY + amp * Math.sin(2 * Math.PI * hz * t)],
      q: [...REST_Q],
    }),
  };
}

// Sinusoidal shake on z (amp `ampZ`) with a smaller companion wobble on x (amp `ampX`), no
// rotation. The x wobble is deliberately in phase with z (same `sin(2*pi*hz*t)`), not a
// separate oscillator — a hard shake couples both axes together rather than beating against
// each other.
function shakePhase(seconds: number, hz = 6, ampZ = 6, ampX = 2): Phase {
  return {
    name: 'shake',
    seconds,
    pose: (t: number) => ({
      a: [ampX * Math.sin(2 * Math.PI * hz * t), 0, -GRAVITY + ampZ * Math.sin(2 * Math.PI * hz * t)],
      q: [...REST_Q],
    }),
  };
}

// Five discrete strikes on z: each a `spikeAmp` spike `spikeWidth` wide, followed immediately by
// a `reboundAmp` rebound `reboundWidth` wide, spaced `gap` apart; rest otherwise.
function strikePhase(seconds: number): Phase {
  const spikeAmp = 25;
  const reboundAmp = -8;
  const spikeWidth = 0.02;
  const reboundWidth = 0.04;
  const gap = 0.6;
  const firstSpike = 0.2;
  const starts = [0, 1, 2, 3, 4].map((i) => firstSpike + i * gap);
  return {
    name: 'strike',
    seconds,
    pose: (t: number) => {
      for (const start of starts) {
        if (t >= start && t < start + spikeWidth) {
          return { a: [0, 0, -GRAVITY + spikeAmp], q: [...REST_Q] };
        }
        if (t >= start + spikeWidth && t < start + spikeWidth + reboundWidth) {
          return { a: [0, 0, -GRAVITY + reboundAmp], q: [...REST_Q] };
        }
      }
      return restPose();
    },
  };
}

function stillPhase(seconds: number, label?: string): Phase {
  return label !== undefined
    ? { name: 'still', seconds, pose: () => restPose(), label }
    : { name: 'still', seconds, pose: () => restPose() };
}

function settlePhase(seconds: number): Phase {
  return { name: 'settle', seconds, pose: () => restPose() };
}

/** rest 2, tilt 3, sway 4, shake 3, strike 3.5, still 4, settle 1.5 — the full audition run. */
export function syntheticPhases(): Phase[] {
  return [
    restPhase(2),
    tiltPhase(3),
    swayPhase(4),
    shakePhase(3),
    strikePhase(3.5),
    stillPhase(4),
    settlePhase(1.5),
  ];
}

/** rest 1, shake 2, settle 1 — a fast smoke pass. */
export function quickPhases(): Phase[] {
  return [restPhase(1), shakePhase(2), settlePhase(1)];
}

/** syntheticPhases() with an extra 60 s preloaded-still inserted right before shake (Task 6's
 * `--long`, exercising the "cheap when unheard on a standby slot" preload path). */
export function longPhases(): Phase[] {
  const phases = syntheticPhases();
  const shakeIndex = phases.findIndex((p) => p.name === 'shake');
  const inserted: Phase = { ...stillPhase(60, 'preloaded 60 s'), preload: true };
  return [...phases.slice(0, shakeIndex), inserted, ...phases.slice(shakeIndex)];
}

/** Default ceiling for the quiet phases (rest/still/settle): 0.02 linear, about -34 dBFS. */
export const DEFAULT_REST_MAX_PEAK = 0.02;

export interface ExpectedOptions {
  /** Ceiling (linear peak) for rest/still/settle. Default DEFAULT_REST_MAX_PEAK; raise it for a
   * patch whose note designs an audible rest (the audition's `--rest-max <dBFS>`). */
  restMaxPeak?: number;
}

/** Linear peak values (0-1, as `/airkit/cos/levels` reports) expected while a phase plays.
 * rest/still/settle stay under the rest ceiling (near silent by default; `restMaxPeak` raises
 * it for a patch designed to sound at rest); shake/strike should clearly register; every phase
 * must stay under the clipping ceiling. */
export function expected(phase: Phase, opts: ExpectedOptions = {}): { minPeak?: number; maxPeak?: number } {
  switch (phase.name) {
    case 'rest':
    case 'still':
    case 'settle':
      return { maxPeak: opts.restMaxPeak ?? DEFAULT_REST_MAX_PEAK };
    case 'shake':
    case 'strike':
      return { minPeak: 0.01, maxPeak: 0.98 };
    default:
      return { maxPeak: 0.98 };
  }
}

// --- take replay ---------------------------------------------------------------------------

interface Row {
  t: number;
  a: [number, number, number];
  q: [number, number, number, number];
}

function isFiniteNumberArray(v: unknown, len: number): v is number[] {
  return Array.isArray(v) && v.length === len && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Parses one take.jsonl row line. Returns null for anything malformed — not JSON, wrong arity
 * on `a`/`q`, or a non-finite number (including a numeric literal so large it parses to
 * Infinity) — so the caller can skip it and keep the rest. */
function parseRow(line: string): Row | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.t !== 'number' || !Number.isFinite(o.t)) return null;
  if (!isFiniteNumberArray(o.a, 3) || !isFiniteNumberArray(o.q, 4)) return null;
  const a = o.a as number[];
  const q = o.q as number[];
  return { t: o.t, a: [a[0]!, a[1]!, a[2]!], q: [q[0]!, q[1]!, q[2]!, q[3]!] };
}

/** Formats a seconds value for a take-phase label: whole numbers with no decimal point,
 * otherwise up to 2 decimal places with trailing zeros trimmed (1 -> "1", 1.5 -> "1.5",
 * 1.99 -> "1.99"). Rounds first to absorb float noise from repeated addition. */
function formatSec(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** True for an object that looks like Task 4's take header (`{label, wrist, id, startedAt,
 * hz}`) rather than a row: a row always carries `t`/`a`/`q`, a header never does. Used so a
 * header-less take (lines are rows from the very first line) still keeps all of its rows,
 * instead of always discarding `lines[0]` as if it were a header. */
function looksLikeHeader(obj: unknown): obj is { label?: unknown } {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return !('t' in o) && !('a' in o) && !('q' in o);
}

/** Parses a take file (header line + row lines, Task 4's shapes) into one replay phase per
 * `windowSec`-second window (the last window is shorter when the take's duration isn't an exact
 * multiple). Each phase's `pose(t)` holds the take's row at or before that instant — clamping to
 * the take's very first row before it starts and to its very last row after it ends — and
 * malformed rows are dropped before windowing, so they never affect the count or the hold. An
 * empty or header-only take yields no phases. */
export function takePhases(lines: string[], windowSec = 5): Phase[] {
  if (lines.length === 0) return [];

  let label = 'take';
  let rowLines = lines;
  let firstParsed: unknown;
  try {
    firstParsed = JSON.parse(lines[0]!);
  } catch {
    firstParsed = undefined;
  }
  if (firstParsed !== undefined && looksLikeHeader(firstParsed)) {
    if (typeof firstParsed.label === 'string') label = firstParsed.label;
    rowLines = lines.slice(1);
  }

  const rows: Row[] = [];
  for (const line of rowLines) {
    if (line.trim() === '') continue;
    const row = parseRow(line);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return [];

  const firstT = rows[0]!.t;
  const lastT = rows[rows.length - 1]!.t;
  const durationSec = Math.max(0, (lastT - firstT) / 1000);

  const poseAt = (queryMs: number): Pose => {
    const clamped = Math.min(Math.max(queryMs, firstT), lastT);
    // largest index with rows[index].t <= clamped ("hold": the row at or before that time).
    let lo = 0;
    let hi = rows.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]!.t <= clamped) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const row = rows[ans]!;
    // fresh copies: a caller mutating a returned pose must not corrupt a later query.
    return { a: [...row.a], q: [...row.q] };
  };

  const phases: Phase[] = [];
  const totalWindows = Math.max(1, Math.ceil(durationSec / windowSec));
  let windowStartSec = 0;
  for (let i = 0; i < totalWindows; i++) {
    const windowStartMs = firstT + windowStartSec * 1000;
    const remaining = durationSec - windowStartSec;
    const seconds = Math.min(windowSec, remaining);
    const endSec = windowStartSec + seconds;
    phases.push({
      name: 'take',
      seconds,
      label: `${label} ${formatSec(windowStartSec)}–${formatSec(endSec)}s`,
      pose: (t: number) => poseAt(windowStartMs + t * 1000),
    });
    windowStartSec = endSec;
  }
  return phases;
}
