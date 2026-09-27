// Fake AirKit [COS] engine: a UDP double of airkit/code3.0/conditions/main_conditions.scd (plus the
// upstream getRoster/getSeats/loadPersonality handlers) for every runner test. Contract: API.md [COS].
import { createSocket, type Socket, type RemoteInfo } from 'node:dgram';
import { encodeMessage, flattenPacket, type OscArg } from '../../scripts/lib/osc.ts';
import { WRISTS, type Wrist } from '../src/scenes.ts';
import { monotonicMs } from '../src/clock.ts';

export interface FakeAirkitOptions { roster?: string[]; readyDelayMs?: number; port?: number; levelsHz?: number }
type LogEntry = { address: string; args: unknown[]; from: number; t: number };
type Device = { name: string; index: number; ready: boolean; loadedAt: number };
type WristState = { pos: number; level: number; fade: number };
export interface FakeAirkit {
  port: number; log: LogEntry[]; errors: string[];
  devices: Map<number, Device>;                                   // port → device (created by IMU)
  params: Map<number, Record<string, unknown>>; partner: Map<number, number>;   // slot → …
  wrists: Record<Wrist, WristState>; master: number; auditionLevel: number; auditionWrist: string | null; panics: number;
  levels: number[];                     // 12 floats the broadcast sends; tests set them
  readyOverride: Record<number, string>;  // port → name every later loadPersonality on that port lands as
  sent(address: string): LogEntry[];
  stop(): Promise<void>; start(): Promise<void>; close(): void;
}

const SLOTS = 9;
// OSC floats are float32; print them the way sclang does (0.1f → 0.1) so tests compare plain decimals.
function f32(x: OscArg): OscArg {
  if (typeof x !== 'number' || Number.isInteger(x) || !Number.isFinite(x)) return x;
  for (let p = 1; p <= 9; p++) { const d = Number(x.toPrecision(p)); if (Math.fround(d) === x) return d; }
  return x;
}
const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const freshWrists = () => Object.fromEntries(WRISTS.map((w) => [w, { pos: 0, level: 1, fade: 0.1 }])) as Record<Wrist, WristState>;

export async function fakeAirkit(opts: FakeAirkitOptions = {}): Promise<FakeAirkit> {
  const roster = opts.roster ?? ['silence', 'COS_Template', 'silence'];
  const readyDelayMs = opts.readyDelayMs ?? 20;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const readyTimers = new Map<number, ReturnType<typeof setTimeout>>();   // port → pending ready
  let sock: Socket | null = null;
  let levelsTimer: ReturnType<typeof setInterval> | null = null;
  let target: { address: string; port: number } | null = null;
  let closed = false;

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms); t.unref(); timers.add(t); return t;
  };
  const reply = (r: { address: string; port: number }, address: string, args: OscArg[] = [], types?: string) => {
    sock?.send(encodeMessage(address, args, types), r.port, r.address);
  };
  const slotDevice = (slot: number) => [...fake.devices.values()].find((d) => d.index === slot);

  function loadOn(port: number, name: string) {
    const d = fake.devices.get(port)!;
    d.name = fake.readyOverride[port] ?? name; d.ready = false; d.loadedAt = monotonicMs();
    const prev = readyTimers.get(port); if (prev) { clearTimeout(prev); timers.delete(prev); }
    readyTimers.set(port, later(readyDelayMs, () => { readyTimers.delete(port); d.ready = true; }));
  }

  function statusJson(): string {
    const slots = Array.from({ length: SLOTS }, (_, i) => {
      const d = slotDevice(i + 1);
      return { slot: i + 1, name: d ? d.name : '', tickAgeMs: d ? 30 : -1, initAgeMs: d?.ready ? 100 : -1, ready: d?.ready ?? false };
    });
    return JSON.stringify({
      slots, wrists: fake.wrists, master: fake.master, serverCpu: 12.3, limiterOn: 1,
      audition: fake.auditionWrist, auditionLevel: fake.auditionLevel, state: 'idle', deviceCount: fake.devices.size,
    });
  }

  function onMessage(address: string, a: OscArg[], r: RemoteInfo) {
    fake.log.push({ address, args: a, from: r.port, t: monotonicMs() });
    if (address.startsWith('/airkit/cos/')) target = { address: r.address, port: r.port };
    const imu = /^\/(\d+)\/IMUFusedData$/.exec(address);
    if (imu) {
      const n = Number(imu[1]); const port = r.port + n - 1;
      if (n >= 1 && n <= SLOTS && !fake.devices.has(port)) {
        fake.devices.set(port, { name: 'silence', index: n, ready: false, loadedAt: monotonicMs() });
        loadOn(port, 'silence');
      }
      return;
    }
    switch (address) {
      case '/airkit/getRoster': reply(r, '/airkit/roster/reply', roster); break;
      case '/airkit/getSeats': {
        const pairs: OscArg[] = []; for (const [p, d] of fake.devices) pairs.push(p, d.name);
        reply(r, '/airkit/seats/reply', pairs); break;
      }
      case '/airkit/loadPersonality': {
        const port = Number(a[0]), index = Number(a[1]);
        if (!fake.devices.has(port)) { fake.errors.push(`loadPersonality: no device on port ${port}`); break; }
        loadOn(port, roster[index % (roster.length - 1)]!); break;
      }
      case '/airkit/cos/params': {
        const p: Record<string, unknown> = {};
        for (let i = 1; i + 1 < a.length; i += 2) p[String(a[i])] = a[i + 1];
        fake.params.set(Number(a[0]), p); break;
      }
      case '/airkit/cos/partner': {
        const slot = Number(a[0]), p = Number(a[1] ?? 0);
        if (p === 0) fake.partner.delete(slot); else fake.partner.set(slot, p); break;
      }
      case '/airkit/cos/xfade': {
        const w = String(a[0]) as Wrist; if (!WRISTS.includes(w)) break;
        fake.wrists[w].pos = clip(Number(a[1] ?? 0), 0, 1); fake.wrists[w].fade = Math.max(0.01, Number(a[2] ?? 0.1)); break;
      }
      case '/airkit/cos/level': {
        const gain = clip(Number(a[1] ?? 1), 0, 4);
        if (a[0] === 'audition') { fake.auditionLevel = gain; break; }
        const w = String(a[0]) as Wrist; if (WRISTS.includes(w)) fake.wrists[w].level = gain; break;
      }
      case '/airkit/cos/master': fake.master = clip(Number(a[0] ?? 1), 0, 4); break;
      case '/airkit/cos/audition': fake.auditionWrist = WRISTS.includes(String(a[0]) as Wrist) ? String(a[0]) : null; break;
      case '/airkit/cos/getStatus': reply(r, '/airkit/cos/status/reply', [statusJson()]); break;
      case '/airkit/cos/panic':
        for (const w of WRISTS) fake.wrists[w].level = 0;
        fake.auditionLevel = 0; fake.panics++;
        for (const port of fake.devices.keys()) loadOn(port, roster[0]!);
        break;
    }
  }

  function forget() {
    for (const t of timers) clearTimeout(t); timers.clear(); readyTimers.clear();
    if (levelsTimer) clearInterval(levelsTimer); levelsTimer = null;
    fake.devices.clear(); fake.params.clear(); fake.partner.clear();
    fake.wrists = freshWrists(); fake.master = 1; fake.auditionLevel = 1; fake.auditionWrist = null; target = null;
  }

  const fake: FakeAirkit = {
    port: opts.port ?? 0, log: [], errors: [], devices: new Map(), params: new Map(), partner: new Map(),
    wrists: freshWrists(), master: 1, auditionLevel: 1, auditionWrist: null, panics: 0,
    levels: new Array(12).fill(0), readyOverride: {},
    sent: (address) => fake.log.filter((m) => m.address === address),
    async start() {
      if (closed || sock) return;
      const s = createSocket('udp4');
      s.on('message', (buf, r) => {
        let msgs; try { msgs = flattenPacket(buf); } catch { return; }
        for (const m of msgs) onMessage(m.address, m.args.map(f32), r);
      });
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        s.bind(fake.port, '127.0.0.1', () => { s.removeListener('error', reject); resolve(); });
      });
      s.on('error', () => {});
      sock = s; fake.port = s.address().port;
      // Doubles, not the engine's float32, so tests can compare exact values; the link reads either.
      levelsTimer = setInterval(() => { if (target) reply(target, '/airkit/cos/levels', fake.levels, 'd'.repeat(12)); }, 1000 / (opts.levelsHz ?? 10));
      levelsTimer.unref();
    },
    async stop() {
      forget();
      const s = sock; sock = null;
      if (s) await new Promise<void>((r) => s.close(() => r()));
    },
    close() { if (closed) return; closed = true; forget(); sock?.close(); sock = null; },
  };
  await fake.start();
  return fake;
}
