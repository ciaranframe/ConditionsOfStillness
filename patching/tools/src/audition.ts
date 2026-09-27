// Audition a patch on the engine's audition slot (9) through a private device. Task 6, ruling 3.
//
// The tool binds its own UDP source port P (default 9101) and streams `/9/IMUFusedData` from it,
// so the engine auto-creates a device on port P + 8 with index 9: it shares slot 9's bus and the
// audition monitor, next to (never instead of) a runner's own slot-9 device on 9009. It never
// binds 9001 and never sends anything for slots 1–8. Sequence: roster → stream at rest until the
// device exists → params/partner/audition level for slot 9 → load → ready → phases (status polled
// at 5 Hz so the levels broadcast stays pointed at us; audition peak/rms max-held per phase) →
// load silence, check silence, audition level left at 1 → scan the engine log for errors.
//
// Levels per phase keep two maxima. `peakAll` covers every levels message received while the
// phase plays and is checked against the 0.98 clip ceiling and, for shake/strike, the minPeak
// onset floor. `peakSettled` skips the phase's first 0.5 s (graceMs) and is used only for the
// rest ceiling of the quiet phases (rest/still/settle; 0.02 ≈ −34 dBFS unless `restMaxPeak`
// raises it for a patch designed to sound at rest): quiet phases ignore their first 0.5 s for
// release tails of whatever played before them. The after-unload silence check is always strict
// (< 0.01). `serverCpu` from the 5 Hz status polls is max-held while the phases play. The log
// scan covers the audition only (from the byte offset at which runAudition started), not the
// engine's boot.
//
// EngineLink's bind/ask/reply-matching pattern is copied from runner/src/airkit.ts (AirkitLink,
// itself after the Glimmer show engine's sticks/airkit.ts, Ciaran Frame 2026); bootEngine /
// killEngine follow scripts/engine-smoke.ts's recipe.
import { createSocket, type Socket } from 'node:dgram';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { encodeMessage, flattenPacket, type OscArg, type OscMessage } from '../../../scripts/lib/osc.ts';
import { DEFAULT_REST_MAX_PEAK, expected, type Phase, type Pose } from './phases.ts';
import { SCLANG, airkitRoot, repoRoot } from './sc.ts';

export const AUDITION_SLOT = 9;
const REST: Pose = { a: [0, 0, -9.8], q: [0, 0, 0, 1] };
const ERROR_RE = /ERROR|not understood|DoesNotUnderstand|FAILURE/;
const CLIP = 0.98;
const QUIET = new Set(['rest', 'still', 'settle']);

const now = () => performance.now();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

// --- EngineLink --------------------------------------------------------------------------------

export interface EngineLinkOptions { host: string; port: number; srcPort: number; log?: (m: string) => void }

export class EngineLink {
  private opts: EngineLinkOptions;
  private sock: Socket;
  private bound = false;
  private closed = false;
  private waiters: Array<{ address: string; resolve: (m: OscMessage | null) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private levelListeners: Array<(f: number[]) => void> = [];
  srcPort: number;

  constructor(opts: EngineLinkOptions) {
    this.opts = opts;
    this.srcPort = opts.srcPort;
    this.sock = createSocket('udp4');
    this.sock.on('message', (buf) => this.onReply(buf));
    this.sock.on('error', (err) => opts.log?.(`[audition] socket error: ${err.message}`));
  }

  async bind(): Promise<void> {
    if (this.closed || this.bound) return;
    await new Promise<void>((resolve, reject) => {
      // One-shot rejecter so a bind failure (EADDRINUSE) settles; a failed bind disables the link
      // for good (an unbound socket would bind an ephemeral port on first send — a ghost device).
      const onBindError = (err: Error) => { this.closed = true; reject(err); };
      this.sock.once('error', onBindError);
      this.sock.bind(this.opts.srcPort, '0.0.0.0', () => {
        this.sock.removeListener('error', onBindError);
        this.srcPort = this.sock.address().port;
        this.bound = true;
        resolve();
      });
    });
  }

  send(address: string, args: OscArg[] = [], types?: string) {
    if (this.closed || !this.bound) return;
    this.sock.send(encodeMessage(address, args, types), this.opts.port, this.opts.host);
  }

  onLevels(fn: (f: number[]) => void) { this.levelListeners.push(fn); }

  private onReply(buf: Buffer) {
    let msgs: OscMessage[];
    try { msgs = flattenPacket(buf); } catch { return; }
    for (const m of msgs) {
      if (m.address === '/airkit/cos/levels' && m.args.length >= 12) {
        const f = m.args.map(Number);
        for (const fn of this.levelListeners) fn(f);
      }
      const i = this.waiters.findIndex((w) => w.address === m.address);
      if (i >= 0) { const w = this.waiters.splice(i, 1)[0]!; clearTimeout(w.timer); w.resolve(m); }
    }
  }

  ask(address: string, reply: string, timeoutMs: number, args: OscArg[] = []): Promise<OscMessage | null> {
    if (this.closed || !this.bound) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = {
        address: reply, resolve,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(null);
        }, timeoutMs),
      };
      waiter.timer.unref();
      this.waiters.push(waiter);
      this.send(address, args);
    });
  }

  async getRoster(ms: number): Promise<string[] | null> {
    const m = await this.ask('/airkit/getRoster', '/airkit/roster/reply', ms);
    return m ? m.args.map(String) : null;
  }

  async getSeats(ms: number): Promise<Record<number, string> | null> {
    const m = await this.ask('/airkit/getSeats', '/airkit/seats/reply', ms);
    if (!m) return null;
    const out: Record<number, string> = {};
    for (let i = 0; i + 1 < m.args.length; i += 2) out[Number(m.args[i])] = String(m.args[i + 1]);
    return out;
  }

  async getStatus(ms: number): Promise<EngineStatus | null> {
    const m = await this.ask('/airkit/cos/getStatus', '/airkit/cos/status/reply', ms);
    if (!m) return null;
    try { return JSON.parse(String(m.args[0])) as EngineStatus; } catch { return null; }
  }

  close() {
    if (this.closed && !this.bound) return;
    this.closed = true;
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.resolve(null); }
    if (this.bound) { this.bound = false; try { this.sock.close(); } catch { /* already closed */ } }
  }
}

export interface EngineStatus {
  slots: Array<{ slot: number; name: string; tickAgeMs: number; initAgeMs: number; ready: boolean }>;
  auditionLevel: number; deviceCount: number; [k: string]: unknown;
}

/** One getStatus from a throwaway ephemeral socket: true when the engine answers within `ms`. */
export async function probeEngine(host: string, port: number, ms = 1000): Promise<boolean> {
  const link = new EngineLink({ host, port, srcPort: 0 });
  try {
    await link.bind();
    return (await link.getStatus(ms)) !== null;
  } catch {
    return false;
  } finally {
    link.close();
  }
}

// --- runAudition -------------------------------------------------------------------------------

export interface AuditionTimeouts {
  askMs: number; seatsMs: number; readyMs: number; silenceMs: number; pollMs: number; imuHz: number; graceMs: number;
}
const DEFAULT_TIMEOUTS: AuditionTimeouts = { askMs: 1000, seatsMs: 2000, readyMs: 5000, silenceMs: 1000, pollMs: 200, imuHz: 100, graceMs: 500 };

export interface AuditionOptions {
  host: string; port: number; srcPort: number; patch: string; phases: Phase[];
  params?: Record<string, string | number>;
  /** Ceiling (linear peak) for rest/still/settle; default 0.02 (≈ −34 dBFS). */
  restMaxPeak?: number;
  log?: (m: string) => void;
  /** Engine log to scan for errors written since the run began. */
  engineLog?: string;
  timeouts?: Partial<AuditionTimeouts>;
  /** Test/diagnostic hooks: called as each phase starts, and once after the last one ends. */
  onPhase?: (phase: Phase, index: number) => void;
  onPhasesDone?: () => void;
  /** Called right after the patch load is sent: the engine port it went to and the device port. */
  onLoaded?: (enginePort: number, devicePort: number) => void;
}

export interface PhaseResult {
  name: string; label?: string; seconds: number;
  /** max over every levels message during the phase (clip ceiling, onset floor). */
  peak: number; rms: number; samples: number;
  /** max over messages after the first graceMs (quiet-phase ceiling only). */
  peakSettled: number; settledSamples: number;
  verdict: 'ok' | 'fail'; why?: string;
}

export interface AuditionResult {
  outcome: 'pass' | 'fail' | 'couldNotRun';
  reason?: string;
  roster?: string[];
  srcPort: number; devicePort: number;
  ready: boolean; silenced: boolean; auditionLevelRestored: boolean;
  phases: PhaseResult[];
  /** The rest/still/settle ceiling this run judged against (linear). */
  restMaxPeak: number;
  /** Highest `serverCpu` (%) reported by the status polls while the phases played. */
  serverCpuMax?: number;
  errors: string[];        // engine-log lines matching ERROR_RE since the run began
  notes: string[];
  table: string;
}

export const dbfs = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmtDb = (x: number) => { const d = dbfs(x); return Number.isFinite(d) ? d.toFixed(1) : '-inf'; };

export function formatTable(phases: PhaseResult[], o: { restMaxPeak?: number; serverCpuMax?: number } = {}): string {
  const rows = [['phase', 'seconds', 'peak dBFS', 'rms dBFS', 'verdict']];
  for (const p of phases) {
    const settled = QUIET.has(p.name) && p.settledSamples > 0 ? ` (settled ${fmtDb(p.peakSettled)})` : '';
    rows.push([p.label ?? p.name, String(Math.round(p.seconds * 100) / 100), fmtDb(p.peak), fmtDb(p.rms), (p.verdict === 'ok' ? 'ok' : `FAIL ${p.why ?? ''}`.trim()) + settled]);
  }
  const w = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  const line = (r: string[]) => r.map((cell, c) => cell.padEnd(w[c]!)).join(' | ');
  const cpu = o.serverCpuMax === undefined ? 'n/a' : `${o.serverCpuMax.toFixed(1)} %`;
  return [
    `rest ceiling ${fmtDb(o.restMaxPeak ?? DEFAULT_REST_MAX_PEAK)} dBFS (settled peak of rest/still/settle)`,
    line(rows[0]!), w.map((n) => '-'.repeat(n)).join('-|-'), ...rows.slice(1).map(line),
    `server cpu (max) ${cpu}`,
  ].join('\n');
}

export function verdictFor(phase: Phase, r: { peak: number; samples: number; peakSettled: number; settledSamples: number }, o: { restMaxPeak?: number } = {}): { verdict: 'ok' | 'fail'; why?: string } {
  if (r.samples === 0) return { verdict: 'fail', why: 'no levels received' };
  if (r.peak > CLIP) return { verdict: 'fail', why: `clipping: peak > ${fmtDb(CLIP)} dBFS` };
  const e = expected(phase, o.restMaxPeak === undefined ? {} : { restMaxPeak: o.restMaxPeak });
  if (e.minPeak !== undefined && r.peak < e.minPeak) return { verdict: 'fail', why: `peak < ${fmtDb(e.minPeak)} dBFS` };
  if (e.maxPeak !== undefined) {
    // quiet phases: judged after their grace (release tails); a phase too short to have settled
    // samples falls back to every sample.
    const quiet = QUIET.has(phase.name);
    const v = quiet && r.settledSamples > 0 ? r.peakSettled : r.peak;
    if (v > e.maxPeak) return { verdict: 'fail', why: `${quiet ? 'settled peak' : 'peak'} > ${fmtDb(e.maxPeak)} dBFS` };
  }
  return { verdict: 'ok' };
}

function logSize(path: string | undefined): number {
  if (!path || !existsSync(path)) return 0;
  try { return statSync(path).size; } catch { return 0; }
}

/** Lines matching ERROR|not understood|DoesNotUnderstand|FAILURE written to `path` after byte `from`. */
export function scanLog(path: string | undefined, from: number): string[] {
  if (!path || !existsSync(path)) return [];
  let size: number;
  try { size = statSync(path).size; } catch { return []; }
  const start = size < from ? 0 : from;   // truncated/rotated since: scan it all
  if (size <= start) return [];
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8').split('\n').filter((l) => ERROR_RE.test(l));
  } finally {
    closeSync(fd);
  }
}

export async function runAudition(opts: AuditionOptions): Promise<AuditionResult> {
  const t: AuditionTimeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
  const log = opts.log ?? ((m: string) => console.log(m));
  const link = new EngineLink({ host: opts.host, port: opts.port, srcPort: opts.srcPort, log });
  const result: AuditionResult = {
    outcome: 'couldNotRun', srcPort: opts.srcPort, devicePort: opts.srcPort + AUDITION_SLOT - 1,
    ready: false, silenced: false, auditionLevelRestored: false, phases: [], errors: [], notes: [], table: '',
    restMaxPeak: opts.restMaxPeak ?? DEFAULT_REST_MAX_PEAK,
  };
  const logFrom = logSize(opts.engineLog);
  let pose: (tSec: number) => Pose = () => REST;
  let poseStart = now();
  let imuTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let loaded = false;
  let unloaded = false;

  // Levels: max-hold of the audition peak/rms into whichever phase is current — every sample
  // into peak/rms, and those after the grace into peakSettled.
  type Acc = { peak: number; rms: number; samples: number; peakSettled: number; settledSamples: number; since: number };
  let current: Acc | null = null;
  let lastAuditionPeak: { value: number; at: number } | null = null;
  link.onLevels((f) => {
    lastAuditionPeak = { value: f[8]!, at: now() };
    if (!current) return;
    current.peak = Math.max(current.peak, f[8]!);
    current.rms = Math.max(current.rms, f[9]!);
    current.samples++;
    if (now() - current.since >= t.graceMs) {
      current.peakSettled = Math.max(current.peakSettled, f[8]!);
      current.settledSamples++;
    }
  });

  const couldNotRun = (reason: string) => { result.outcome = 'couldNotRun'; result.reason = reason; log(`[audition] could not run: ${reason}`); return result; };

  try {
    try {
      await link.bind();
    } catch (e) {
      return couldNotRun(`cannot bind udp/${opts.srcPort}: ${(e as Error).message}`);
    }
    result.srcPort = link.srcPort;
    result.devicePort = link.srcPort + AUDITION_SLOT - 1;
    const devicePort = result.devicePort;
    log(`[audition] bound udp/${link.srcPort}; private device will be port ${devicePort} (index ${AUDITION_SLOT})`);

    // 2. roster
    const roster = await link.getRoster(t.askMs);
    if (!roster) return couldNotRun(`no roster reply from the engine at ${opts.host}:${opts.port}`);
    result.roster = roster;
    const index = roster.indexOf(opts.patch);
    if (index < 0 || (index === 0 && opts.patch !== 'silence')) {
      log(`[audition] roster: ${roster.map((n, i) => `${i}:${n}`).join(' ')}`);
      return couldNotRun(`${opts.patch} is not in the roster (add it with npm run patch:roster -- add ${opts.patch})`);
    }
    if (!(await link.getStatus(t.askMs))) return couldNotRun('the engine answers getRoster but not getStatus (still booting?)');

    // 3. IMU stream at rest until the private device exists
    imuTimer = setInterval(() => {
      const p = pose((now() - poseStart) / 1000);
      link.send(`/${AUDITION_SLOT}/IMUFusedData`, [...p.a, ...p.q], 'fffffff');
    }, 1000 / t.imuHz);
    imuTimer.unref();
    let seats: Record<number, string> | null = null;
    const seatsT0 = now();
    while (now() - seatsT0 < t.seatsMs) {
      await sleep(100);
      seats = await link.getSeats(Math.min(500, t.askMs));
      if (seats && devicePort in seats) break;
    }
    if (!seats || !(devicePort in seats)) return couldNotRun(`device port ${devicePort} did not appear in getSeats within ${t.seatsMs} ms`);
    const runnerNine = 9001 + AUDITION_SLOT - 1;
    if (runnerNine !== devicePort && runnerNine in seats) {
      result.notes.push(`a second index-9 device exists (port ${runnerNine}, the runner's): getStatus's slot 9 entry may describe either; both share slot 9's bus`);
    }

    // 4. slot-9 params, partner, audition level, then load
    const flat: OscArg[] = [AUDITION_SLOT];
    for (const [k, v] of Object.entries(opts.params ?? {})) flat.push(k, v);
    link.send('/airkit/cos/params', flat);
    link.send('/airkit/cos/partner', [AUDITION_SLOT, 0], 'ii');
    link.send('/airkit/cos/level', ['audition', 1, 0.1], 'sff');
    link.send('/airkit/loadPersonality', [devicePort, index], 'ii');
    loaded = true;
    opts.onLoaded?.(opts.port, devicePort);
    log(`[audition] loading ${opts.patch} (roster index ${index}) on port ${devicePort}`);

    const readyT0 = now();
    while (now() - readyT0 < t.readyMs) {
      await sleep(100);
      const st = await link.getStatus(t.askMs);
      const s9 = st?.slots?.[AUDITION_SLOT - 1];
      if (s9 && s9.name === opts.patch && s9.ready) { result.ready = true; break; }
    }
    if (!result.ready && result.notes.length > 0) {
      // Two index-9 devices: the status entry may be the runner's. Fall back to our seat's name.
      const s = await link.getSeats(t.askMs);
      if (s?.[devicePort] === opts.patch) {
        result.ready = true;
        result.notes.push('ready inferred from getSeats and UNVERIFIED (status slot 9 described the other index-9 device)');
        log(`[audition] ready inferred from getSeats (${devicePort} shows ${opts.patch}); unverified — status slot 9 describes the other index-9 device`);
      }
    }
    if (!result.ready) {
      result.outcome = 'fail';
      result.reason = `${opts.patch} did not report ready on slot 9 within ${t.readyMs} ms`;
      log(`[audition] ${result.reason}`);
    } else {
      log(`[audition] ${opts.patch} ready after ${Math.round(now() - readyT0)} ms`);

      // 5. phases, polling status at 5 Hz (keeps the levels broadcast pointed at us); serverCpu
      // from each reply is max-held while a phase is playing.
      pollTimer = setInterval(() => {
        void link.getStatus(t.askMs).then((st) => {
          const cpu = Number(st?.serverCpu);
          if (current && st && Number.isFinite(cpu)) result.serverCpuMax = Math.max(result.serverCpuMax ?? 0, cpu);
        });
      }, t.pollMs);
      pollTimer.unref();
      for (let i = 0; i < opts.phases.length; i++) {
        const phase = opts.phases[i]!;
        const preload = phase.preload === true;
        if (preload) link.send('/airkit/cos/level', ['audition', 0, 0.1], 'sff');
        opts.onPhase?.(phase, i);
        current = { peak: 0, rms: 0, samples: 0, peakSettled: 0, settledSamples: 0, since: now() };
        poseStart = now();
        pose = phase.pose;
        log(`[audition] phase ${phase.label ?? phase.name} (${phase.seconds} s)`);
        await sleep(phase.seconds * 1000);
        const c = current;
        current = null;
        if (preload) link.send('/airkit/cos/level', ['audition', 1, 0.1], 'sff');
        const pr: PhaseResult = {
          name: phase.name, seconds: phase.seconds, peak: c.peak, rms: c.rms, samples: c.samples,
          peakSettled: c.peakSettled, settledSamples: c.settledSamples, ...verdictFor(phase, c, { restMaxPeak: result.restMaxPeak }),
        };
        if (phase.label) pr.label = phase.label;
        result.phases.push(pr);
      }
      opts.onPhasesDone?.();
      pose = () => REST;
    }

    // 6. silence, level back to 1
    const unloadAt = now();
    link.send('/airkit/loadPersonality', [devicePort, 0], 'ii');
    unloaded = true;
    if (!pollTimer) { pollTimer = setInterval(() => { void link.getStatus(t.askMs); }, t.pollMs); pollTimer.unref(); }
    // silent = a levels message at least 150 ms after the unload (fresh audio, not the max-hold of
    // what played before it) with peak < 0.01, all within silenceMs.
    while (now() - unloadAt < t.silenceMs) {
      await sleep(25);
      const lp = lastAuditionPeak as { value: number; at: number } | null;
      if (lp && lp.at - unloadAt >= 150 && lp.value < 0.01) { result.silenced = true; break; }
    }
    if (!result.silenced) log(`[audition] audition peak did not fall below -40 dBFS within ${t.silenceMs} ms of loading silence`);
    const s = await link.getSeats(t.askMs);
    if (s?.[devicePort] !== 'silence') { result.silenced = false; log(`[audition] port ${devicePort} is on ${s?.[devicePort] ?? '?'}, not silence`); }
    link.send('/airkit/cos/level', ['audition', 1, 0.1], 'sff');
    // stop the background poll so its replies can't be taken for ours; retry up to 500 ms.
    clearInterval(pollTimer);
    pollTimer = null;
    let lastLevel: number | undefined;
    const levelT0 = now();
    while (now() - levelT0 < 500) {
      const st = await link.getStatus(Math.max(50, Math.min(t.askMs, 500 - (now() - levelT0))));
      lastLevel = st?.auditionLevel;
      if (lastLevel === 1) { result.auditionLevelRestored = true; break; }
      await sleep(50);
    }
    if (!result.auditionLevelRestored) log(`[audition] auditionLevel is ${lastLevel}, expected 1`);

    // 7. engine log
    result.errors = scanLog(opts.engineLog, logFrom);

    if (result.outcome !== 'fail') {
      const ok = result.phases.every((p) => p.verdict === 'ok') && result.silenced && result.auditionLevelRestored && result.errors.length === 0;
      result.outcome = ok ? 'pass' : 'fail';
      if (!ok) {
        const why: string[] = [];
        const bad = result.phases.filter((p) => p.verdict !== 'ok').map((p) => p.label ?? p.name);
        if (bad.length) why.push(`phase(s) out of range: ${bad.join(', ')}`);
        if (!result.silenced) why.push('not silent after unloading');
        if (!result.auditionLevelRestored) why.push('audition level not restored');
        if (result.errors.length) why.push(`${result.errors.length} error line(s) in the engine log`);
        result.reason = why.join('; ');
      }
    }
    return result;
  } finally {
    if (loaded && !unloaded) {
      // interrupted between load and unload: best effort to leave slot 9's device silent
      link.send('/airkit/loadPersonality', [result.devicePort, 0], 'ii');
      link.send('/airkit/cos/level', ['audition', 1, 0.1], 'sff');
    }
    if (pollTimer) clearInterval(pollTimer);
    if (imuTimer) clearInterval(imuTimer);
    link.close();
    result.table = formatTable(result.phases, result.serverCpuMax === undefined
      ? { restMaxPeak: result.restMaxPeak }
      : { restMaxPeak: result.restMaxPeak, serverCpuMax: result.serverCpuMax });
  }
}

// --- private engine boot (scripts/engine-smoke.ts recipe) -----------------------------------------

export interface BootedEngine { child: ChildProcess; langPort: number; scsynthPort: number; logPath: string }

export function defaultBootLog(): string { return join(homedir(), '.conditions', 'audition.log'); }

/** Boots `main_conditions.scd` on langPort/scsynthPort (57130/57131) with COS_SAMPLES = the repo's
 * samples/, logging to `logPath`; resolves once the log says `Conditions AirKit up` (≤ timeoutMs). */
export async function bootEngine(o: { langPort?: number; scsynthPort?: number; logPath?: string; timeoutMs?: number; log?: (m: string) => void; onSpawn?: (e: BootedEngine) => void } = {}): Promise<BootedEngine> {
  const langPort = o.langPort ?? 57130;
  const scsynthPort = o.scsynthPort ?? 57131;
  const logPath = o.logPath ?? defaultBootLog();
  const timeoutMs = o.timeoutMs ?? 150_000;
  const main = join(airkitRoot(), 'code3.0', 'conditions', 'main_conditions.scd');
  if (!existsSync(main)) throw new Error(`missing ${main}; run ./setup.sh`);
  mkdirSync(dirname(logPath), { recursive: true });
  spawnSync('pkill', ['-f', `scsynth -u ${scsynthPort}`]);
  const fd = openSync(logPath, 'w');
  const child = spawn(SCLANG, ['-u', String(langPort), main], {
    env: { ...process.env, COS_SCSYNTH_PORT: String(scsynthPort), COS_LIMITER: '1', COS_SAMPLES: join(repoRoot(), 'samples') },
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  const engine: BootedEngine = { child, langPort, scsynthPort, logPath };
  o.onSpawn?.(engine);   // published at once, so a signal during the boot can still kill it
  let exited = false;
  child.once('exit', () => { exited = true; });
  const t0 = now();
  o.log?.(`[audition] booting a private engine on ${langPort}/${scsynthPort} (log ${logPath})`);
  while (now() - t0 < timeoutMs) {
    await sleep(500);
    if (exited) { await killEngine(engine); throw new Error(`sclang exited during boot; see ${logPath}`); }
    let text = '';
    try { text = readFileSync(logPath, 'utf8'); } catch { /* not yet */ }
    if (text.includes('Conditions AirKit up')) { o.log?.(`[audition] engine up after ${((now() - t0) / 1000).toFixed(1)} s`); return engine; }
  }
  await killEngine(engine);
  throw new Error(`engine not up within ${timeoutMs / 1000} s; see ${logPath}`);
}

/** Kills only this tool's sclang and the scsynth on its own port. */
export async function killEngine(e: BootedEngine): Promise<void> {
  const c = e.child;
  if (c.exitCode === null && c.signalCode === null) {
    const gone = new Promise<void>((r) => c.once('exit', () => r()));
    c.kill('SIGTERM');
    const timer = setTimeout(() => { c.kill('SIGKILL'); }, 3000);
    timer.unref();
    await Promise.race([gone, sleep(5000)]);
    clearTimeout(timer);
  }
  spawnSync('pkill', ['-f', `scsynth -u ${e.scsynthPort}`]);
}
