// Audition phases and take replay (pure). Task 5. Two families of coverage:
//  - the synthetic gesture phases (rest/tilt/sway/shake/strike/still/settle): every sampled
//    pose is finite and carries a unit quaternion, the constant-pose phases (rest/still/settle)
//    are exactly gravity-at-rest, tilt ramps to 40 deg over 2 s then holds, sway/shake hit their
//    specified peak-from-gravity amplitude on z within 1%, and strike fires exactly five spikes
//    with rebounds.
//  - takePhases, which turns a recorded take.jsonl (Task 4's header + row shapes) into windowed
//    replay phases with hold/clamp semantics, skipping malformed rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  expected,
  longPhases,
  quickPhases,
  syntheticPhases,
  takePhases,
  type Phase,
  type Pose,
} from '../src/phases.ts';

const GRAVITY = 9.8;
const TOL = 1e-9;

function deg2rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function quatNormSqError(q: Pose['q']): number {
  return Math.abs(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3] - 1);
}

function assertFinitePose(pose: Pose, where: string): void {
  for (const n of [...pose.a, ...pose.q]) assert.ok(Number.isFinite(n), `non-finite value in ${where}`);
}

/** Samples pose(t) every stepSec from 0 up to (not including) phase.seconds, plus the final
 * instant itself, so both mid-phase and end-of-phase values are covered. */
function sampleEvery(phase: Phase, stepSec: number): { t: number; pose: Pose }[] {
  const out: { t: number; pose: Pose }[] = [];
  for (let t = 0; t < phase.seconds; t += stepSec) out.push({ t, pose: phase.pose(t) });
  out.push({ t: phase.seconds, pose: phase.pose(phase.seconds) });
  return out;
}

// --- syntheticPhases: shape ---------------------------------------------------------------------

test('syntheticPhases: names and durations, in order', () => {
  const names = syntheticPhases().map((p) => ({ name: p.name, seconds: p.seconds }));
  assert.deepEqual(names, [
    { name: 'rest', seconds: 2 },
    { name: 'tilt', seconds: 3 },
    { name: 'sway', seconds: 4 },
    { name: 'shake', seconds: 3 },
    { name: 'strike', seconds: 3.5 },
    { name: 'still', seconds: 4 },
    { name: 'settle', seconds: 1.5 },
  ]);
});

test('quickPhases: rest 1, shake 2, settle 1', () => {
  const names = quickPhases().map((p) => ({ name: p.name, seconds: p.seconds }));
  assert.deepEqual(names, [
    { name: 'rest', seconds: 1 },
    { name: 'shake', seconds: 2 },
    { name: 'settle', seconds: 1 },
  ]);
});

test('longPhases: syntheticPhases with a 60 s still inserted right before shake', () => {
  const synthetic = syntheticPhases();
  const long = longPhases();
  assert.equal(long.length, synthetic.length + 1);

  const shakeIndex = long.findIndex((p) => p.name === 'shake');
  const inserted = long[shakeIndex - 1]!;
  assert.equal(inserted.name, 'still');
  assert.equal(inserted.seconds, 60);
  assert.equal(inserted.label, 'preloaded 60 s');

  // everything else matches syntheticPhases(), in the same relative order.
  const withoutInserted = long.filter((_, i) => i !== shakeIndex - 1);
  assert.deepEqual(
    withoutInserted.map((p) => ({ name: p.name, seconds: p.seconds })),
    synthetic.map((p) => ({ name: p.name, seconds: p.seconds })),
  );
});

// --- every synthetic phase: finite, unit quaternion, rest-family exactness ---------------------

test('every synthetic phase: sampled every 10ms, poses are finite with a unit quaternion', () => {
  for (const phase of syntheticPhases()) {
    for (const { t, pose } of sampleEvery(phase, 0.01)) {
      assertFinitePose(pose, `${phase.name} at t=${t}`);
      assert.ok(quatNormSqError(pose.q) <= 1e-6, `${phase.name} at t=${t}: |q|^2 = ${pose.q}`);
    }
  }
});

test('rest, still and settle are exactly gravity-at-rest at every sampled instant', () => {
  for (const phase of syntheticPhases().filter((p) => p.name === 'rest' || p.name === 'still' || p.name === 'settle')) {
    for (const { t, pose } of sampleEvery(phase, 0.01)) {
      assert.deepEqual(pose.a, [0, 0, -GRAVITY], `${phase.name} at t=${t}`);
      assert.deepEqual(pose.q, [0, 0, 0, 1], `${phase.name} at t=${t}`);
    }
  }
});

// --- tilt ----------------------------------------------------------------------------------------

test('tilt ramps linearly to 40 deg over 2s, then holds', () => {
  const tilt = syntheticPhases().find((p) => p.name === 'tilt')!;
  const theta40 = deg2rad(40);

  // half-way through the ramp: 20 deg.
  const half = tilt.pose(1);
  const theta20 = deg2rad(20);
  assert.ok(Math.abs(half.a[1] - GRAVITY * Math.sin(theta20)) < TOL);
  assert.ok(Math.abs(half.a[2] - -GRAVITY * Math.cos(theta20)) < TOL);
  assert.ok(Math.abs(half.q[0] - Math.sin(theta20 / 2)) < TOL);
  assert.ok(Math.abs(half.q[3] - Math.cos(theta20 / 2)) < TOL);

  // end of ramp and through the hold (3s total: 2s ramp + 1s hold).
  for (const t of [2, 2.3, 2.7, 2.999, 3]) {
    const pose = tilt.pose(t);
    assert.ok(Math.abs(pose.a[0]) < TOL, `tilt at t=${t}: a.x should stay 0`);
    assert.ok(Math.abs(pose.a[1] - GRAVITY * Math.sin(theta40)) < TOL, `tilt at t=${t}: a.y`);
    assert.ok(Math.abs(pose.a[2] - -GRAVITY * Math.cos(theta40)) < TOL, `tilt at t=${t}: a.z`);
    assert.ok(Math.abs(pose.q[0] - Math.sin(theta40 / 2)) < TOL, `tilt at t=${t}: q.x`);
    assert.ok(Math.abs(pose.q[1]) < TOL);
    assert.ok(Math.abs(pose.q[2]) < TOL);
    assert.ok(Math.abs(pose.q[3] - Math.cos(theta40 / 2)) < TOL, `tilt at t=${t}: q.w`);
  }

  // starts at identity.
  const start = tilt.pose(0);
  assert.deepEqual(start.a, [0, 0, -GRAVITY]);
  assert.deepEqual(start.q, [0, 0, 0, 1]);
});

// --- sway / shake amplitude ------------------------------------------------------------------

test('sway: 0.5 Hz, peak deviation from gravity on z is 3 m/s^2 within 1%', () => {
  const sway = syntheticPhases().find((p) => p.name === 'sway')!;
  let peak = 0;
  for (let t = 0; t < sway.seconds; t += 0.001) {
    peak = Math.max(peak, Math.abs(sway.pose(t).a[2] - -GRAVITY));
  }
  assert.ok(peak >= 3 * 0.99 && peak <= 3 * 1.01, `sway peak deviation = ${peak}`);
  // no rotation and no x/y disturbance.
  assert.deepEqual(sway.pose(0.37).q, [0, 0, 0, 1]);
  assert.equal(sway.pose(0.37).a[0], 0);
  assert.equal(sway.pose(0.37).a[1], 0);
});

test('shake: 6 Hz, peak deviation from gravity on z is 6 within 1%, on x is 2 within 1%', () => {
  const shake = syntheticPhases().find((p) => p.name === 'shake')!;
  let peakZ = 0;
  let peakX = 0;
  for (let t = 0; t < shake.seconds; t += 0.0005) {
    const pose = shake.pose(t);
    peakZ = Math.max(peakZ, Math.abs(pose.a[2] - -GRAVITY));
    peakX = Math.max(peakX, Math.abs(pose.a[0]));
  }
  assert.ok(peakZ >= 6 * 0.99 && peakZ <= 6 * 1.01, `shake peak z deviation = ${peakZ}`);
  assert.ok(peakX >= 2 * 0.99 && peakX <= 2 * 1.01, `shake peak x = ${peakX}`);
});

// --- strike ----------------------------------------------------------------------------------

test('strike: exactly five spikes >= 20 m/s^2 above gravity, each followed by a rebound', () => {
  const strike = syntheticPhases().find((p) => p.name === 'strike')!;
  const step = 0.001;
  const samples: { t: number; dev: number }[] = [];
  for (let t = 0; t < strike.seconds; t += step) {
    samples.push({ t, dev: strike.pose(t).a[2] - -GRAVITY });
  }

  // group contiguous samples where the deviation clears the 20 m/s^2 threshold into runs.
  const runs: { start: number; end: number }[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < samples.length; i++) {
    const above = samples[i]!.dev >= 20;
    if (above && runStart === null) runStart = i;
    if (!above && runStart !== null) {
      runs.push({ start: samples[runStart]!.t, end: samples[i - 1]!.t });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ start: samples[runStart]!.t, end: samples[samples.length - 1]!.t });

  assert.equal(runs.length, 5, `expected 5 spikes, found ${runs.length}`);

  // each spike is followed (within 0.1s of its end) by a rebound of at least 5 m/s^2 below gravity.
  for (const run of runs) {
    const reboundFound = samples.some((s) => s.t > run.end && s.t <= run.end + 0.1 && s.dev <= -5);
    assert.ok(reboundFound, `no rebound found after spike ending at t=${run.end}`);
  }

  // outside spikes/rebounds, strike is at rest.
  const restSample = strike.pose(strike.seconds - 0.01);
  assert.deepEqual(restSample.a, [0, 0, -GRAVITY]);
});

// --- expected() ----------------------------------------------------------------------------

test('expected(): per-name minPeak/maxPeak', () => {
  const byName = new Map(syntheticPhases().map((p) => [p.name, p] as const));
  const takePhase: Phase = { name: 'take', seconds: 1, pose: () => ({ a: [0, 0, -GRAVITY], q: [0, 0, 0, 1] }) };

  assert.deepEqual(expected(byName.get('rest')!), { maxPeak: 0.02 });
  assert.deepEqual(expected(byName.get('still')!), { maxPeak: 0.02 });
  assert.deepEqual(expected(byName.get('settle')!), { maxPeak: 0.02 });
  assert.deepEqual(expected(byName.get('shake')!), { minPeak: 0.01, maxPeak: 0.98 });
  assert.deepEqual(expected(byName.get('strike')!), { minPeak: 0.01, maxPeak: 0.98 });
  assert.deepEqual(expected(byName.get('tilt')!), { maxPeak: 0.98 });
  assert.deepEqual(expected(byName.get('sway')!), { maxPeak: 0.98 });
  assert.deepEqual(expected(takePhase), { maxPeak: 0.98 });

  // never >= 0.98 clipping bound across every returned value.
  for (const phase of [...syntheticPhases(), takePhase]) {
    const e = expected(phase);
    if (e.maxPeak !== undefined) assert.ok(e.maxPeak <= 0.98);
  }
});

// --- takePhases ------------------------------------------------------------------------------

function takeHeader(label: string): string {
  return JSON.stringify({ label, wrist: null, id: '3', startedAt: '2026-09-27T00:00:00.000Z', hz: 100 });
}

test('takePhases: 200 rows at 10ms, windowSec=1 -> two windows with the right durations and labels', () => {
  const lines = [takeHeader('mytake')];
  for (let i = 0; i < 200; i++) {
    lines.push(JSON.stringify({ t: i * 10, a: [i, i + 1, i + 2], q: [0, 0, 0, 1] }));
  }

  const phases = takePhases(lines, 1);
  assert.equal(phases.length, 2, `expected 2 windows, got ${phases.length}`);
  assert.equal(phases[0]!.name, 'take');
  assert.equal(phases[0]!.seconds, 1);
  assert.equal(phases[0]!.label, 'mytake 0–1s');

  assert.ok(Math.abs(phases[1]!.seconds - 0.99) < 1e-6, `second window seconds = ${phases[1]!.seconds}`);
  assert.equal(phases[1]!.label, 'mytake 1–1.99s');
});

test('takePhases: hold semantics — a query between rows returns the earlier row', () => {
  const lines = [takeHeader('holdtake')];
  for (let i = 0; i < 200; i++) {
    lines.push(JSON.stringify({ t: i * 10, a: [i, i + 1, i + 2], q: [0, 0, 0, 1] }));
  }
  const [w0] = takePhases(lines, 1);

  // t=0.015s -> absolute ms=15 -> row at t=10 (index 1) is the latest row at or before 15.
  assert.equal(w0!.pose(0.015).a[0], 1);
  // exact row boundary: t=0.02s -> ms=20 -> row index 2.
  assert.equal(w0!.pose(0.02).a[0], 2);
});

test('takePhases: clamps before the first row and after the last row', () => {
  const lines = [takeHeader('clamptake')];
  for (let i = 0; i < 200; i++) {
    lines.push(JSON.stringify({ t: i * 10, a: [i, i + 1, i + 2], q: [0, 0, 0, 1] }));
  }
  const [w0, w1] = takePhases(lines, 1);

  // before the very first row (negative t): clamps to row 0.
  assert.equal(w0!.pose(-5).a[0], 0);
  // well past the very last row (row 199, t=1990ms): clamps to the last row.
  assert.equal(w1!.pose(5).a[0], 199);
});

test('takePhases: a malformed row (wrong arity or non-finite) is skipped, the rest kept', () => {
  const lines = [
    takeHeader('quick'),
    JSON.stringify({ t: 0, a: [100, 101, 102], q: [0, 0, 0, 1] }),
    JSON.stringify({ t: 5, a: [1, 2], q: [0, 0, 0, 1] }), // wrong arity (a has 2 elements) — skipped
    JSON.stringify({ t: 10, a: [110, 111, 112], q: [0, 0, 0, 1] }),
    JSON.stringify({ t: 15, a: [1e400, 0, 0], q: [0, 0, 0, 1] }), // parses to Infinity — non-finite, skipped
    JSON.stringify({ t: 20, a: [120, 121, 122], q: [0, 0, 0, 1] }),
  ];

  const phases = takePhases(lines, 5);
  assert.equal(phases.length, 1);
  const [w0] = phases;
  assert.equal(w0!.label, 'quick 0–0.02s');

  assert.equal(w0!.pose(0.005).a[0], 100); // t=5 row skipped -> holds at t=0 row
  assert.equal(w0!.pose(0.01).a[0], 110); // exact match at t=10
  assert.equal(w0!.pose(0.015).a[0], 110); // t=15 row skipped -> holds at t=10 row
  assert.equal(w0!.pose(0.02).a[0], 120); // exact match at t=20

  for (const t of [0, 0.005, 0.01, 0.015, 0.02]) assertFinitePose(w0!.pose(t), `quick take at t=${t}`);
});

test('takePhases: an empty take (header only) yields no phases', () => {
  assert.deepEqual(takePhases([takeHeader('empty')]), []);
});
