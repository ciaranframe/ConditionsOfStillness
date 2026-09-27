// Audition tool tests (Review Focus 3) against the runner's fake AirKit engine: the tool drives
// only its private device (srcPort + 8, index 9), never slots 1–8; sets params/partner/level for
// slot 9 before loading; polls status often enough to keep the levels broadcast; reads the
// audition peak per phase; leaves the device on silence and the audition level at 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { runAudition, verdictFor } from '../src/audition.ts';
import { longPhases, quickPhases } from '../src/phases.ts';
import { fakeAirkit, type FakeAirkit } from '../../../runner/test/fake-airkit.ts';

// Plays the engine's part for the audition monitor: once the fake has received the unload
// (loadPersonality <devicePort> 0 after a patch load), the slot-9 levels drop to 0.
function silenceOnUnload(fake: FakeAirkit, devicePort: () => number): () => void {
  const timer = setInterval(() => {
    const loads = fake.sent('/airkit/loadPersonality').filter((m) => Number(m.args[0]) === devicePort());
    const patchAt = loads.findIndex((m) => Number(m.args[1]) !== 0);
    if (patchAt >= 0 && loads.slice(patchAt + 1).some((m) => Number(m.args[1]) === 0)) { fake.levels[8] = 0; fake.levels[9] = 0; }
  }, 10);
  timer.unref();
  return () => clearInterval(timer);
}

async function freePort(): Promise<number> {
  const s = createSocket('udp4');
  await new Promise<void>((r) => s.bind(0, '127.0.0.1', () => r()));
  const p = s.address().port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

test('auditions on the private slot-9 device only, reads levels per phase, restores silence and level', async () => {
  const fake = await fakeAirkit({ roster: ['silence', 'COS_Template', 'silence'] });
  const srcPort = await freePort();
  const devicePort = srcPort + 8;
  const lines: string[] = [];
  let runStart = 0;
  let runEnd = 0;
  const stopWatch = silenceOnUnload(fake, () => devicePort);
  try {
    const result = await runAudition({
      host: '127.0.0.1', port: fake.port, srcPort, patch: 'COS_Template', phases: quickPhases(),
      params: { register: 'low', density: 3 },
      log: (m) => lines.push(m),
      onPhase: (phase) => {
        if (runStart === 0) runStart = performance.now();
        fake.levels[8] = phase.name === 'shake' ? 0.3 : 0;
        fake.levels[9] = phase.name === 'shake' ? 0.1 : 0;
      },
      onPhasesDone: () => { runEnd = performance.now(); },
    });

    assert.equal(result.outcome, 'pass', JSON.stringify(result, null, 2) + '\n' + lines.join('\n'));
    assert.equal(result.devicePort, devicePort);

    // Only the private device: IMU only on /9/, loads only on srcPort + 8.
    const imuOther = fake.log.filter((m) => /^\/[1-8]\/IMUFusedData$/.test(m.address));
    assert.equal(imuOther.length, 0, 'sent IMU for slots 1–8');
    assert.ok(fake.sent('/9/IMUFusedData').length > 50, 'IMU stream too sparse');
    const loads = fake.sent('/airkit/loadPersonality');
    assert.ok(loads.length >= 2);
    for (const l of loads) {
      const port = Number(l.args[0]);
      assert.equal(port, devicePort, `load on port ${port}`);
      assert.ok(!(port >= srcPort && port <= srcPort + 7));
    }
    assert.equal(fake.errors.length, 0, fake.errors.join('\n'));

    // params/partner/level for slot 9, all before the patch load.
    const firstLoad = fake.log.findIndex((m) => m.address === '/airkit/loadPersonality' && Number(m.args[1]) === 1);
    assert.ok(firstLoad >= 0);
    const before = fake.log.slice(0, firstLoad);
    const params = before.find((m) => m.address === '/airkit/cos/params');
    assert.deepEqual(params?.args, [9, 'register', 'low', 'density', 3]);
    const partner = before.find((m) => m.address === '/airkit/cos/partner');
    assert.deepEqual(partner?.args, [9, 0]);
    const level = before.find((m) => m.address === '/airkit/cos/level');
    assert.deepEqual(level?.args, ['audition', 1, 0.1]);
    assert.equal(fake.sent('/airkit/cos/audition').length, 0, 'must not touch the runner\'s audition wrist');
    for (const m of fake.log) {
      if (m.address === '/airkit/cos/params' || m.address === '/airkit/cos/partner') assert.equal(Number(m.args[0]), 9);
    }

    // End state: the device back on silence, audition level 1.
    assert.equal(fake.devices.get(devicePort)?.name, 'silence');
    assert.equal(fake.devices.size, 1);
    assert.equal(fake.auditionLevel, 1);

    // Table: three phases, the shake reflecting the fake's 0.3.
    assert.deepEqual(result.phases.map((p) => p.name), ['rest', 'shake', 'settle']);
    const shake = result.phases[1]!;
    assert.ok(Math.abs(shake.peak - 0.3) < 1e-6, `shake peak ${shake.peak}`);
    assert.ok(Math.abs(shake.rms - 0.1) < 1e-6, `shake rms ${shake.rms}`);
    assert.equal(result.phases[0]!.peak, 0);
    assert.equal(result.phases[2]!.peak, 0);
    assert.ok(result.phases.every((p) => p.verdict === 'ok'));
    assert.ok(result.silenced);

    // getStatus polled at 5 Hz while the phases played: no gap over 400 ms (200 ms + scheduler
    // jitter on a loaded machine; the runner's own poll is 2 s).
    const polls = fake.sent('/airkit/cos/getStatus').map((m) => m.t).filter((t) => t >= runStart && t <= runEnd);
    assert.ok(polls.length >= 10, `only ${polls.length} status polls during ~4 s of phases`);
    for (let i = 1; i < polls.length; i++) assert.ok(polls[i]! - polls[i - 1]! <= 400, `gap ${polls[i]! - polls[i - 1]!} ms`);
    assert.ok(polls[0]! - runStart <= 400 && runEnd - polls[polls.length - 1]! <= 400);

    // CPU: the fake reports serverCpu 12.3 in every status reply; max-held during the phases.
    assert.ok(result.serverCpuMax !== undefined && Math.abs(result.serverCpuMax - 12.3) < 1e-6, `serverCpuMax ${result.serverCpuMax}`);
    assert.match(result.table, /server cpu \(max\) 12\.3 %/);
    assert.match(result.table, /^rest ceiling -34\.0 dBFS/);

    // Table text.
    assert.match(result.table, /phase\s*\|\s*seconds\s*\|\s*peak dBFS\s*\|\s*rms dBFS\s*\|\s*verdict/);
    assert.match(result.table, /shake\s*\|\s*2\s*\|\s*-10\.5/);
  } finally {
    stopWatch();
    fake.close();
  }
});

test('a clipping onset in the first 100 ms of shake fails the run (no grace on the clip ceiling)', async () => {
  const fake = await fakeAirkit({ levelsHz: 50 });
  const srcPort = await freePort();
  const stopWatch = silenceOnUnload(fake, () => srcPort + 8);
  try {
    const result = await runAudition({
      host: '127.0.0.1', port: fake.port, srcPort, patch: 'COS_Template', phases: quickPhases(), log: () => {},
      onPhase: (phase) => {
        if (phase.name !== 'shake') { fake.levels[8] = 0; return; }
        fake.levels[8] = 0.99;
        setTimeout(() => { fake.levels[8] = 0.3; }, 100).unref();
      },
    });
    assert.equal(result.outcome, 'fail');
    const shake = result.phases.find((p) => p.name === 'shake')!;
    assert.equal(shake.verdict, 'fail');
    assert.match(shake.why ?? '', /clipping/);
    assert.ok(shake.peak >= 0.99 - 1e-6);
    assert.ok(result.silenced);
  } finally {
    stopWatch();
    fake.close();
  }
});

test('levels that stay up after the unload fail the silence check', async () => {
  const fake = await fakeAirkit();
  const srcPort = await freePort();
  try {
    fake.levels[8] = 0.3;   // never lowered: the "patch" keeps sounding after silence is loaded
    const result = await runAudition({
      host: '127.0.0.1', port: fake.port, srcPort, patch: 'COS_Template', phases: [quickPhases()[1]!], log: () => {},
    });
    assert.equal(result.phases[0]!.verdict, 'ok');
    assert.equal(result.silenced, false);
    assert.equal(result.outcome, 'fail');
    assert.match(result.reason ?? '', /not silent/);
    assert.equal(fake.auditionLevel, 1);
  } finally {
    fake.close();
  }
});

test('--long: level audition 0 before the preloaded phase and 1 after it', async () => {
  const fake = await fakeAirkit();
  const srcPort = await freePort();
  const stopWatch = silenceOnUnload(fake, () => srcPort + 8);
  const starts: Array<{ name: string; preload: boolean; t: number }> = [];
  // longPhases() shape at 0.3 s a phase (the real preload is 60 s)
  const phases = longPhases().map((p) => ({ ...p, seconds: 0.3 }));
  try {
    const result = await runAudition({
      host: '127.0.0.1', port: fake.port, srcPort, patch: 'COS_Template', phases, log: () => {},
      onPhase: (phase) => {
        starts.push({ name: phase.name, preload: phase.preload === true, t: performance.now() });
        fake.levels[8] = phase.name === 'shake' || phase.name === 'strike' ? 0.3 : 0;
      },
    });
    const pre = starts.findIndex((s) => s.preload);
    assert.ok(pre >= 0 && starts[pre + 1]!.name === 'shake');
    const levels = fake.sent('/airkit/cos/level').map((m) => ({ gain: Number(m.args[1]), t: m.t, who: String(m.args[0]) }));
    assert.ok(levels.every((l) => l.who === 'audition'));
    assert.deepEqual(levels.map((l) => l.gain), [1, 0, 1, 1]);   // setup, preload on, preload off, end
    const [, off, on] = levels;
    assert.ok(off!.t <= starts[pre]!.t + 50 && off!.t >= starts[pre - 1]!.t, 'level 0 sent as the preloaded phase starts');
    assert.ok(on!.t >= starts[pre]!.t + 250 && on!.t <= starts[pre + 1]!.t + 50, 'level 1 sent as the preloaded phase ends');
    assert.equal(fake.auditionLevel, 1);
    assert.equal(result.outcome, 'pass', JSON.stringify(result.phases));
  } finally {
    stopWatch();
    fake.close();
  }
});

test('a patch that is not in the roster cannot run: roster listed, nothing loaded', async () => {
  const fake = await fakeAirkit({ roster: ['silence', 'COS_Template', 'silence'] });
  const srcPort = await freePort();
  const lines: string[] = [];
  try {
    const result = await runAudition({
      host: '127.0.0.1', port: fake.port, srcPort, patch: 'COS_Nowhere', phases: quickPhases(), log: (m) => lines.push(m),
    });
    assert.equal(result.outcome, 'couldNotRun');
    assert.deepEqual(result.roster, ['silence', 'COS_Template', 'silence']);
    assert.match(result.reason ?? '', /COS_Nowhere.*not in the roster/);
    assert.match(lines.join('\n'), /COS_Template/);
    assert.equal(fake.sent('/airkit/loadPersonality').length, 0);
    assert.equal(fake.sent('/9/IMUFusedData').length, 0);
  } finally {
    fake.close();
  }
});

test('an engine that never answers cannot run', async () => {
  const srcPort = await freePort();
  const dead = await freePort();
  const result = await runAudition({
    host: '127.0.0.1', port: dead, srcPort, patch: 'COS_Template', phases: quickPhases(), log: () => {},
    timeouts: { askMs: 200 },
  });
  assert.equal(result.outcome, 'couldNotRun');
  assert.match(result.reason ?? '', /roster/);
});

test('verdictFor: a 0.3 level at rest fails the default ceiling and passes with restMaxPeak 0.5', () => {
  const rest = quickPhases()[0]!;
  assert.equal(rest.name, 'rest');
  const levels = { peak: 0.3, samples: 20, peakSettled: 0.3, settledSamples: 15 };
  const byDefault = verdictFor(rest, levels);
  assert.equal(byDefault.verdict, 'fail');
  assert.match(byDefault.why ?? '', /settled peak > -34\.0 dBFS/);
  assert.deepEqual(verdictFor(rest, levels, { restMaxPeak: 0.5 }), { verdict: 'ok' });
  // the clip ceiling still holds whatever the rest ceiling
  assert.equal(verdictFor(rest, { ...levels, peak: 0.99 }, { restMaxPeak: 0.5 }).verdict, 'fail');
});

test('restMaxPeak: a patch that sounds at rest passes with a raised ceiling, fails without; silence after unload stays strict', async () => {
  const phases = quickPhases().map((p) => ({ ...p, seconds: 0.8 }));
  for (const restMaxPeak of [0.5, undefined]) {
    const fake = await fakeAirkit();
    const srcPort = await freePort();
    const stopWatch = silenceOnUnload(fake, () => srcPort + 8);
    try {
      fake.levels[8] = 0.3;   // loud at rest and while shaken; silence on the unload
      const result = await runAudition({
        host: '127.0.0.1', port: fake.port, srcPort, patch: 'COS_Template', phases, log: () => {},
        ...(restMaxPeak === undefined ? {} : { restMaxPeak }),
      });
      assert.equal(result.restMaxPeak, restMaxPeak ?? 0.02);
      assert.ok(result.silenced);
      if (restMaxPeak === undefined) {
        assert.equal(result.outcome, 'fail');
        assert.equal(result.phases.find((p) => p.name === 'rest')!.verdict, 'fail');
      } else {
        assert.equal(result.outcome, 'pass', JSON.stringify(result.phases));
        assert.match(result.table, /^rest ceiling -6\.0 dBFS/);
      }
    } finally {
      stopWatch();
      fake.close();
    }
  }
});

test('next to a live runner: its nine seats (9001–9009) are untouched, the two-index-9 note is given, ready is still reached', async () => {
  const fake = await fakeAirkit({ roster: ['silence', 'COS_Template', 'silence'] });
  // What a running runner leaves in the engine: one device per slot on 9001–9009 (source port
  // 9001), index = slot, COS_Template on slot 2 and silence elsewhere.
  const runnerSeats = new Map<number, string>();
  for (let slot = 1; slot <= 9; slot++) {
    const port = 9000 + slot;
    const name = slot === 2 ? 'COS_Template' : 'silence';
    runnerSeats.set(port, name);
    fake.devices.set(port, { name, index: slot, ready: true, loadedAt: 0 });
  }
  const srcPort = await freePort();
  const devicePort = srcPort + 8;
  const stopWatch = silenceOnUnload(fake, () => devicePort);
  try {
    const result = await runAudition({
      host: '127.0.0.1', port: fake.port, srcPort, patch: 'COS_Template',
      phases: quickPhases().map((p) => ({ ...p, seconds: 0.6 })), log: () => {},
      timeouts: { readyMs: 800 },
      onPhase: (phase) => { fake.levels[8] = phase.name === 'shake' ? 0.3 : 0; },
    });
    assert.ok(result.ready, JSON.stringify(result, null, 2));
    assert.ok(result.notes.some((n) => /second index-9 device.*9009/.test(n)), result.notes.join('\n'));
    for (const [port, name] of runnerSeats) assert.equal(fake.devices.get(port)?.name, name, `seat ${port} changed`);
    const onRunner = fake.sent('/airkit/loadPersonality').filter((m) => Number(m.args[0]) >= 9001 && Number(m.args[0]) <= 9009);
    assert.equal(onRunner.length, 0, 'sent a load to a runner port');
    assert.ok(fake.sent('/airkit/loadPersonality').every((m) => Number(m.args[0]) === devicePort));
    assert.equal(fake.devices.get(devicePort)?.name, 'silence');
  } finally {
    stopWatch();
    fake.close();
  }
});
