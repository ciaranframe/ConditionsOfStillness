// Boot the Conditions engine on spare ports, run the real runner against it with fake sticks, and
// drive the show through the runner's WebSocket: standby preload, cues, live params, panic/resume, audition.
// Usage: node scripts/runner-smoke.ts   (npm run smoke:runner)
// Ports: engine 57130/57131 (as engine-smoke.ts), runner sticks 8010, pages 3010, source port 9001.
// Never touches 57120/57110, so it is safe while a real engine runs (not while engine-smoke runs).
import { spawn, spawnSync } from 'node:child_process';
import { createSocket, type Socket } from 'node:dgram';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encodeMessage, flattenPacket, type OscMessage } from './lib/osc.ts';
import { main as runnerMain } from '../runner/src/main.ts';
import { Log } from '../runner/src/log.ts';
import type { View } from '../runner/src/view.ts';
import { startFakeSticks } from '../runner/test/fake-sticks.ts';

const WebSocket = createRequire(new URL('../runner/package.json', import.meta.url))('ws');

const LANG = 57130, SCSYNTH = 57131, SRC = 9001, STICK_PORT = 8010, WEB_PORT = 3010;
const SCLANG = '/Applications/SuperCollider.app/Contents/MacOS/sclang';
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MAIN = join(ROOT, 'airkit/code3.0/conditions/main_conditions.scd');
const LOG = join(homedir(), '.conditions/runner-smoke.log');                 // engine (sclang) output
const RUNNER_LOG = join(homedir(), '.conditions/runner-smoke.runner.log');   // runner log lines
const WEB = `http://127.0.0.1:${WEB_PORT}`;

const failures: string[] = [];
const check = (ok: boolean, what: string) => { console.log(`${ok ? '[ok]' : '[!!]'} ${what}`); if (!ok) failures.push(what); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const secs = () => ((Date.now() - T0) / 1000).toFixed(1);

/** Poll `probe` every `everyMs` until it returns a truthy value or `ms` elapses; returns the last value. */
async function until<T>(probe: () => Promise<T> | T, ms: number, everyMs = 100): Promise<T> {
  const end = Date.now() + ms;
  let v = await probe();
  while (!v && Date.now() < end) { await sleep(everyMs); v = await probe(); }
  return v;
}

const CAST = `sticks:
  ZL: { id: '1', label: A3, ip: null }
  ZR: { id: '2', label: A4, ip: null }
  CL: { id: '3', label: B1, ip: null }
  CR: { id: '4', label: B2, ip: null }
pedal:
  input: null
  channel: null
  next: { note: 60 }
  back: { note: 62 }
  debounceMs: 150
network:
  stickPort: ${STICK_PORT}
  webPort: ${WEB_PORT}
  airkitHost: 127.0.0.1
  airkitPort: ${LANG}
  sourcePort: ${SRC}
`;

async function smoke() {
  if (!existsSync(MAIN)) { console.error(`missing ${MAIN}; run ./setup.sh`); process.exit(1); }
  mkdirSync(join(homedir(), '.conditions'), { recursive: true });
  spawnSync('pkill', ['-f', `scsynth -u ${SCSYNTH}`]);
  const logFd = openSync(LOG, 'w');
  const engineLog = () => readFileSync(LOG, 'utf8');

  // temp repo root: the shipped scenes, a generated cast, the roster file
  const tmp = mkdtempSync(join(tmpdir(), 'cos-runner-smoke-'));
  mkdirSync(join(tmp, 'scenes'), { recursive: true });
  mkdirSync(join(tmp, 'airkit', 'lists'), { recursive: true });
  copyFileSync(join(ROOT, 'scenes', 'conditions.yaml'), join(tmp, 'scenes', 'conditions.yaml'));
  copyFileSync(join(ROOT, 'airkit', 'lists', 'list_conditions.sc'), join(tmp, 'airkit', 'lists', 'list_conditions.sc'));
  writeFileSync(join(tmp, 'scenes', 'cast.yaml'), CAST);

  // runner log: captured in memory (and written to RUNNER_LOG at the end)
  const runnerLines: string[] = [];
  const log = new Log(2000, Date.now, (s) => { runnerLines.push(s); });

  // spare socket for engine queries (any port; never the runner's 9001)
  const ctl: Socket = createSocket('udp4');
  const inbox: OscMessage[] = [];
  ctl.on('message', (buf) => { for (const m of flattenPacket(Buffer.from(buf))) inbox.push(m); });
  ctl.on('error', (e) => { failures.push(`ctl socket error: ${String(e)}`); });
  const send = (a: string, args: (number | string)[] = []) => ctl.send(encodeMessage(a, args), LANG, '127.0.0.1');
  const take = (address: string) => { const i = inbox.findIndex((m) => m.address === address); return i < 0 ? null : inbox.splice(i, 1)[0]; };
  const ask = async (a: string, reply: string, ms = 1500) => {
    inbox.splice(0, inbox.length, ...inbox.filter((m) => m.address !== reply));
    send(a); const end = Date.now() + ms;
    while (Date.now() < end) { const m = take(reply); if (m) return m; await sleep(10); }
    return null;
  };
  // Note: every /airkit/cos/* message makes its sender the engine's levels target, so a status query here
  // briefly steals the meters from the runner until its next poll (≤ 2 s). Levels are read before any.
  const status = async () => { const m = await ask('/airkit/cos/getStatus', '/airkit/cos/status/reply'); return m ? JSON.parse(String(m.args[0])) : null; };
  const seats = async () => {
    const m = await ask('/airkit/getSeats', '/airkit/seats/reply');
    const out: Record<number, string> = {};   // slot → patch
    if (m) for (let i = 0; i + 1 < m.args.length; i += 2) out[Number(m.args[i]) - SRC + 1] = String(m.args[i + 1]);
    return out;
  };
  const view = async (): Promise<View | null> => {
    try { const r = await fetch(`${WEB}/api/view`); return r.ok ? ((await r.json()) as View) : null; } catch { return null; }
  };

  let child: ReturnType<typeof spawn> | null = null;
  let runner: Awaited<ReturnType<typeof runnerMain>> | null = null;
  let sticks: ReturnType<typeof startFakeSticks> | null = null;
  let ws: any = null;

  try {
    child = spawn(SCLANG, ['-u', String(LANG), MAIN], {
      env: { ...process.env, COS_SCSYNTH_PORT: String(SCSYNTH), COS_LIMITER: '1', COS_SAMPLES: join(ROOT, 'samples') },
      stdio: ['ignore', logFd, logFd],
    });
    await new Promise<void>((res, rej) => { ctl.once('error', rej); ctl.bind(0, () => res()); });

    // 0. engine boot
    const up = await until(() => engineLog().includes('Conditions AirKit up'), 150_000, 200);
    check(up, `engine boots (Conditions AirKit up at ${secs()} s, limit 150 s)`);
    if (!up) throw new Error('engine did not boot');

    // runner, sticks, WebSocket
    runner = await runnerMain({
      repoRoot: tmp, scenesPath: join(tmp, 'scenes', 'conditions.yaml'), castPath: join(tmp, 'scenes', 'cast.yaml'),
      statePath: join(tmp, 'state.json'), airkitHost: '127.0.0.1', airkitPort: LANG, sourcePort: SRC,
      stickPort: STICK_PORT, webPort: WEB_PORT, publicDir: join(ROOT, 'runner', 'public'), log,
    });
    sticks = startFakeSticks({ target: { host: '127.0.0.1', port: STICK_PORT }, ids: ['1', '2', '3', '4'], hz: 50, moving: new Set(['1']) });
    ws = new WebSocket(`ws://127.0.0.1:${WEB_PORT}/`);
    const acks = new Map<number, (a: { ok: boolean; error?: string }) => void>();
    ws.on('message', (data: Buffer) => {
      let m: any; try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'ack' && typeof m.ackId === 'number') { acks.get(m.ackId)?.(m); acks.delete(m.ackId); }
    });
    ws.on('error', (e: Error) => { failures.push(`ws error: ${e.message}`); });
    await new Promise<void>((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    let nextAck = 1;
    const command = (c: object, ms = 8000): Promise<{ ok: boolean; error?: string }> => new Promise((res) => {
      const ackId = nextAck++;
      const timer = setTimeout(() => { acks.delete(ackId); res({ ok: false, error: 'no ack' }); }, ms);
      acks.set(ackId, (a) => { clearTimeout(timer); res(a); });
      ws.send(JSON.stringify({ ...c, ackId }));
    });

    // 1. AIRKIT online, nine devices
    let v = await until(async () => { const x = await view(); return x?.engine.online && x.engine.deviceCount === 9 ? x : null; }, 10_000, 200) ?? await view();
    check(!!v?.engine.online, 'AIRKIT online within 10 s');
    check(v?.engine.deviceCount === 9, `/api/view engine.deviceCount === 9 (got ${v?.engine.deviceCount})`);
    check(v?.status.find((c) => c.key === 'AIRKIT')?.value === 'OK', 'AIRKIT status cell reads OK');

    // 2. STANDBY preload
    const standbyOk = (s: Record<number, string>) => [2, 4, 8].every((n) => s[n] === 'COS_Template') && [1, 3, 5, 6, 7, 9].every((n) => s[n] === 'silence');
    let s = await until(async () => { const x = await seats(); return standbyOk(x) ? x : null; }, 10_000, 200) ?? await seats();
    check(v?.standby === true, 'runner starts in STANDBY');
    check(standbyOk(s), `STANDBY: slots 2 4 8 on COS_Template, 1 3 5 6 7 9 on silence (${JSON.stringify(s)})`);

    // 3. next → A
    let a = await command({ type: 'cue', action: 'next' });
    check(a.ok, `cue next acked (${a.error ?? 'ok'})`);
    const tCue = Date.now();
    let sawA = false, sawFading = false, zlOk = false, sawAInTime = false;
    while (Date.now() - tCue < 12_000) {
      const x = await view();
      if (x?.scene?.id === 'A') { if (!sawA) sawAInTime = Date.now() - tCue <= 3000; sawA = true; }
      if (x?.wrists.ZL.state === 'FADING') sawFading = true;
      if (sawFading && x?.wrists.ZL.state === 'OK') { zlOk = true; break; }
      await sleep(50);
    }
    check(sawA && sawAInTime, 'view.scene.id === A within 3 s');
    check(sawFading, 'ZL passes through FADING');
    check(zlOk, `ZL ends OK (after ${((Date.now() - tCue) / 1000).toFixed(1)} s; A's fade is 6 s)`);
    // levels via the runner's view (the engine sends /airkit/cos/levels to the runner)
    v = await until(async () => { const x = await view(); return x && x.wrists.ZL.peak > 0.002 && x.masterPeak > 0.002 ? x : null; }, 4000, 100) ?? await view();
    check((v?.wrists.ZL.peak ?? 0) > 0.002, `view ZL peak > 0.002 with stick 1 moving (${v?.wrists.ZL.peak})`);
    check((v?.masterPeak ?? 0) > 0.002, `view master peak > 0.002 (${v?.masterPeak})`);
    let st = await status();
    check(st?.wrists?.ZL?.pos === 1, `engine wrists.ZL.pos === 1 (${st?.wrists?.ZL?.pos})`);
    s = await until(async () => { const x = await seats(); return x[1] === 'silence' && x[6] === 'COS_Template' ? x : null; }, 3000, 100) ?? await seats();
    check(s[1] === 'silence', `after the fade slot 1 is silence (${s[1]})`);
    check(s[2] === 'COS_Template' && s[4] === 'COS_Template' && s[8] === 'COS_Template', 'A live on slots 2 4 8');
    check(s[6] === 'COS_Template', `B's CL preloaded on slot 6 (${s[6]})`);

    // 4. next → B: ZR live params (slot 4 never reloads), CL crossfades to slot 6
    let slot4Silent = false, polls = 0, polling = true;
    const poller = (async () => {
      while (polling) { const x = await seats(); if (Object.keys(x).length) { polls++; if (x[4] !== 'COS_Template') slot4Silent = true; } await sleep(100); }
    })();
    a = await command({ type: 'cue', action: 'next' });
    check(a.ok, `cue next → B acked (${a.error ?? 'ok'})`);
    v = await until(async () => { const x = await view(); return x?.scene?.id === 'B' && x.wrists.CL.state === 'OK' && x.wrists.CL.liveSlot === 6 ? x : null; }, 5000, 50) ?? await view();
    await sleep(1500);
    polling = false; await poller;
    check(v?.scene?.id === 'B', 'view.scene.id === B');
    check(!slot4Silent && polls >= 5, `slot 4 stays COS_Template throughout (${polls} seat polls at 100 ms)`);
    check(runnerLines.some((l) => /A4: live change on COS_Template/.test(l)), 'runner logs a live change for ZR (A4), no reload');
    check(v?.wrists.CL.liveSlot === 6, `CL live on slot 6 (${v?.wrists.CL.liveSlot})`);
    st = await status();
    check(st?.wrists?.CL?.pos === 1, `engine wrists.CL.pos === 1 (${st?.wrists?.CL?.pos})`);

    // 5. back → A, jump → D
    a = await command({ type: 'cue', action: 'back' });
    v = await until(async () => { const x = await view(); return x?.scene?.id === 'A' ? x : null; }, 3000, 50);
    check(a.ok && v?.scene?.id === 'A', 'back → A');
    a = await command({ type: 'jump', index: 3 });
    v = await until(async () => { const x = await view(); return x?.scene?.id === 'D' ? x : null; }, 3000, 50);
    check(a.ok && v?.scene?.id === 'D', 'jump index 3 → D');

    // 6. panic, resume
    a = await command({ type: 'panic' });
    check(a.ok, 'panic acked');
    s = await until(async () => { const x = await seats(); return Object.keys(x).length === 9 && Object.values(x).every((n) => n === 'silence') ? x : null; }, 3000, 100) ?? await seats();
    check(Object.keys(s).length === 9 && Object.values(s).every((n) => n === 'silence'), `every seat silence after panic (${JSON.stringify(s)})`);
    st = await until(async () => { const x = await status(); return x && Object.values(x.wrists).every((w: any) => w.level === 0) ? x : null; }, 3000, 100) ?? await status();
    check(!!st && Object.values(st.wrists).every((w: any) => w.level === 0), `every wrist level 0 after panic (${JSON.stringify(st?.wrists)})`);
    check((await view())?.panicked === true, 'view.panicked after panic');
    a = await command({ type: 'resume' });
    check(a.ok, `resume acked (${a.error ?? 'ok'})`);
    // D is all silence (C silences ZL CL CR, D silences ZR), so "D's sounds back" is: every live slot
    // holds what the runner's view says it should, the wrist levels are back at D's 0 dB (gain 1) and
    // the audition monitor is back at 1.
    v = await view();
    const dMatches = (x: Record<number, string>) => !!v && Object.values(v.wrists).every((w) => x[w.liveSlot] === w.patch);
    s = await until(async () => { const x = await seats(); return dMatches(x) ? x : null; }, 3000, 100) ?? await seats();
    check(v?.panicked === false && v?.scene?.id === 'D', 'view back on D, not panicked');
    check(dMatches(s), `D's sounds back on the live slots (${v ? Object.values(v.wrists).map((w) => `${w.wrist}@${w.liveSlot}=${w.patch}`).join(' ') : '?'})`);
    st = await until(async () => { const x = await status(); return x && x.auditionLevel === 1 && Object.values(x.wrists).every((w: any) => Math.abs(w.level - 1) < 1e-3) ? x : null; }, 3000, 100) ?? await status();
    check(!!st && Object.values(st.wrists).every((w: any) => Math.abs(w.level - 1) < 1e-3), `wrist levels restored to 1 (${JSON.stringify(st?.wrists)})`);
    check(st?.auditionLevel === 1, `auditionLevel === 1 (${st?.auditionLevel})`);

    // 7. audition
    a = await command({ type: 'audition', wrist: 'CR', patch: 'COS_Template' });
    check(a.ok, 'audition CR COS_Template acked');
    s = await until(async () => { const x = await seats(); return x[9] === 'COS_Template' ? x : null; }, 3000, 100) ?? await seats();
    check(s[9] === 'COS_Template', `slot 9 on COS_Template (${s[9]})`);
    st = await status();
    check(st?.audition === 'CR', `engine status audition === CR (${st?.audition})`);
    a = await command({ type: 'audition', wrist: 'CR', patch: null });
    check(a.ok, 'audition off acked');
    s = await until(async () => { const x = await seats(); return x[9] === 'silence' ? x : null; }, 3000, 100) ?? await seats();
    check(s[9] === 'silence', `slot 9 back on silence (${s[9]})`);

    // 8. log hygiene
    const bad = engineLog().split('\n').filter((l) => /ERROR|not understood|FAILURE|DoesNotUnderstand/.test(l));
    check(bad.length === 0, `no error lines in the engine log${bad.length ? ':\n  ' + bad.slice(0, 5).join('\n  ') : ''}`);
    const errs = runnerLines.filter((l) => /^\d\d:\d\d:\d\d ERROR /.test(l) && !/PANIC: every wrist silenced/.test(l));
    check(errs.length === 0, `no error lines in the runner log except PANIC${errs.length ? ':\n  ' + errs.slice(0, 5).join('\n  ') : ''}`);
  } catch (e) {
    failures.push(String(e));
    console.log(`[!!] ${String(e)}`);
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
    if (runner) await runner.close().catch((e: unknown) => failures.push(`runner close: ${String(e)}`));
    sticks?.close();
    ctl.close();
    if (child) child.kill('SIGTERM');
    spawnSync('pkill', ['-f', `scsynth -u ${SCSYNTH}`]);
    writeFileSync(RUNNER_LOG, runnerLines.join('\n') + '\n');
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures.length === 0
    ? `\nRUNNER SMOKE PASS in ${secs()} s (engine log: ${LOG}, runner log: ${RUNNER_LOG})`
    : `\nRUNNER SMOKE FAIL: ${failures.length} check(s) in ${secs()} s (engine log: ${LOG}, runner log: ${RUNNER_LOG})`);
  process.exit(failures.length === 0 ? 0 : 1);
}
smoke();
