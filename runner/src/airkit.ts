// The runner's side of the AirKit [COS] contract (airkit/code3.0/API.md). One UDP socket bound
// to the fixed source port: the engine keys device slot n as port sourcePort + n - 1.
// Liveness/reconciliation ideas and the bind-rejecter pattern from the Glimmer show engine
// (code/show-engine/src/sticks/airkit.ts, Ciaran Frame 2026).
import { EventEmitter } from 'node:events';
import { createSocket, type Socket } from 'node:dgram';
import { encodeMessage, flattenPacket, type OscArg, type OscMessage } from '../../scripts/lib/osc.ts';
import { type Wrist, type ParamValue } from './scenes.ts';
import { monotonicMs } from './clock.ts';

export const POLL_MS = 2000, OFFLINE_AFTER_POLLS = 3, READY_POLL_MS = 100;
export const RESTPOSE: number[] = [0, 0, -9.8, 0, 0, 0, 1];
const SLOTS = 9;

export interface SlotStatus { slot: number; name: string; tickAgeMs: number; initAgeMs: number; ready: boolean }
export interface EngineStatus {
  slots: SlotStatus[]; wrists: Record<Wrist, { pos: number; level: number; fade: number }>; master: number; serverCpu: number;
  limiterOn: number; audition: string | null; auditionLevel: number; deviceCount: number; state: string;
}
export interface Levels { ZL: [number, number]; ZR: [number, number]; CL: [number, number]; CR: [number, number]; audition: [number, number]; master: [number, number]; at: number }
export interface AirkitLinkOptions { host: string; port: number; sourcePort: number; pollMs?: number; offlineAfterPolls?: number; readyPollMs?: number; clock?: () => number; log?: (msg: string) => void }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

export class AirkitLink extends EventEmitter {
  private opts: AirkitLinkOptions;
  private sock: Socket;
  private bound = false;
  private closed = false;
  private sockClosed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private waiters: Array<{ address: string; resolve: (m: OscMessage | null) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private _online = false;
  private _roster: string[] = [];
  private _seats: Record<number, string> = {};
  private _status: EngineStatus | null = null;
  private _levels: Levels | null = null;
  private _lastStatusAt = -Infinity;
  private _seatsAsked = 0;              // getSeats requests sent so far: a seats reply answers one sent before it
  private sourcePort: number;
  private clock: () => number;
  private log: (m: string) => void;
  private pollMs: number;
  private offlineMs: number;
  private readyPollMs: number;

  constructor(opts: AirkitLinkOptions) {
    super();
    this.opts = opts;
    this.sourcePort = opts.sourcePort;
    this.clock = opts.clock ?? monotonicMs;
    this.log = opts.log ?? ((m) => console.log(m));
    this.pollMs = opts.pollMs ?? POLL_MS;
    this.offlineMs = this.pollMs * (opts.offlineAfterPolls ?? OFFLINE_AFTER_POLLS);
    this.readyPollMs = opts.readyPollMs ?? READY_POLL_MS;
    this.sock = createSocket('udp4');
    this.sock.on('message', (buf) => this.onReply(buf));
    this.sock.on('error', (err) => this.log(`[airkit] socket error: ${err.message}`));
  }

  get online() { return this._online; }
  get roster() { return this._roster; }
  get seats() { return this._seats; }
  get status() { return this._status; }
  get levels() { return this._levels; }
  get lastStatusAt() { return this._lastStatusAt; }
  get seatsAsked() { return this._seatsAsked; }

  portOf(slot: number) { return this.sourcePort + slot - 1; }

  async start(): Promise<void> {
    if (this.closed || this.bound) return;
    await new Promise<void>((resolve, reject) => {
      // Without the one-shot rejecter a bind failure (EADDRINUSE) would never settle this promise.
      // A failed bind disables the link for good: an unbound socket binds itself to an ephemeral
      // port on the first send, and the engine would key a ghost device on that port.
      const onBindError = (err: Error) => { this.closed = true; reject(err); };
      this.sock.once('error', onBindError);
      this.sock.bind(this.opts.sourcePort, '0.0.0.0', () => {
        this.sock.removeListener('error', onBindError);
        this.sourcePort = this.sock.address().port;
        this.bound = true;
        this.log(`[airkit] bound to udp/${this.sourcePort} (device port = ${this.sourcePort} + slot - 1)`);
        resolve();
      });
    });
    this.poll();
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref();
  }

  private tick() {
    if (this._online && this.clock() - this._lastStatusAt > this.offlineMs) {
      this._online = false;
      this.log('[airkit] offline (no status reply)');
      this.emit('offline');
    }
    this.poll();
  }

  poll() { this.send('/airkit/getRoster'); this.send('/airkit/getSeats'); this.send('/airkit/cos/getStatus'); }

  private send(address: string, args: OscArg[] = [], types?: string) {
    if (this.closed || !this.bound) return;
    if (address === '/airkit/getSeats') this._seatsAsked++;
    this.sock.send(encodeMessage(address, args, types), this.opts.port, this.opts.host);
  }

  private onReply(buf: Buffer) {
    let msgs: OscMessage[];
    try { msgs = flattenPacket(buf); } catch { return; }
    for (const m of msgs) {
      if (m.address === '/airkit/roster/reply') this._roster = m.args.map(String);
      else if (m.address === '/airkit/seats/reply') {
        const s: Record<number, string> = {};
        for (let i = 0; i + 1 < m.args.length; i += 2) s[Number(m.args[i])] = String(m.args[i + 1]);
        this._seats = s;
        this.emit('seats', s);
      } else if (m.address === '/airkit/cos/status/reply') {
        try { this._status = JSON.parse(String(m.args[0])) as EngineStatus; } catch { continue; }
        this._lastStatusAt = this.clock();
        if (!this._online) { this._online = true; this.log('[airkit] online'); this.emit('online'); }
        this.emit('status', this._status);
      } else if (m.address === '/airkit/cos/levels' && m.args.length >= 12) {
        const f = m.args.map(Number);
        this._levels = { ZL: [f[0]!, f[1]!], ZR: [f[2]!, f[3]!], CL: [f[4]!, f[5]!], CR: [f[6]!, f[7]!], audition: [f[8]!, f[9]!], master: [f[10]!, f[11]!], at: this.clock() };
        this.emit('levels', this._levels);
      }
      const i = this.waiters.findIndex((w) => w.address === m.address);
      if (i >= 0) { const w = this.waiters.splice(i, 1)[0]!; clearTimeout(w.timer); w.resolve(m); }
    }
  }

  private ask(address: string, reply: string, timeoutMs: number): Promise<OscMessage | null> {
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
      this.send(address);
    });
  }

  async getStatus(timeoutMs = 1000) { const m = await this.ask('/airkit/cos/getStatus', '/airkit/cos/status/reply', timeoutMs); return m ? this._status : null; }
  async getSeats(timeoutMs = 1000) { const m = await this.ask('/airkit/getSeats', '/airkit/seats/reply', timeoutMs); return m ? this._seats : null; }
  async getRoster(timeoutMs = 1000) { const m = await this.ask('/airkit/getRoster', '/airkit/roster/reply', timeoutMs); return m ? this._roster : null; }

  forwardImu(slot: number, floats: number[]) { this.send(`/${slot}/IMUFusedData`, floats, 'fffffff'); }
  forwardAux(slot: number, kind: 'Battery' | 'DigiIn', args: number[]) { this.send(`/${slot}/${kind}`, args, (kind === 'Battery' ? 'f' : 'i').repeat(args.length)); }
  restPose() { for (let s = 1; s <= SLOTS; s++) this.forwardImu(s, RESTPOSE); }

  async ensureDevices(timeoutMs = 3000): Promise<boolean> {
    const want = Array.from({ length: SLOTS }, (_, i) => this.portOf(i + 1));
    const t0 = this.clock();
    while (!this.closed && this.clock() - t0 < timeoutMs) {
      this.restPose();
      await sleep(100);
      const s = await this.getSeats(500);
      if (s && want.every((p) => p in s)) return true;
    }
    this.log('[airkit] not every device exists after the rest-pose packets');
    return false;
  }

  load(slot: number, patch: string): boolean {
    const index = this._roster.indexOf(patch);
    if (index < 0) { this.log(`[airkit] "${patch}" is not in the roster`); return false; }
    const port = this.portOf(slot);
    if (!(port in this._seats)) { this.log(`[airkit] slot ${slot}: no device on port ${port} yet — load of ${patch} deferred`); return false; }
    this.send('/airkit/loadPersonality', [port, index], 'ii');
    return true;
  }

  // Default typing: integer-valued numbers go as i, others as f, strings as s — the engine takes either numeric type.
  params(slot: number, params: Record<string, ParamValue>) {
    const flat: OscArg[] = [slot];
    for (const [k, v] of Object.entries(params)) flat.push(k, v);
    this.send('/airkit/cos/params', flat);
  }
  partner(slot: number, partnerSlot: number | null) { this.send('/airkit/cos/partner', [slot, partnerSlot ?? 0], 'ii'); }
  xfade(wrist: Wrist, pos: 0 | 1, fadeSec: number) { this.send('/airkit/cos/xfade', [wrist, pos, fadeSec], 'sff'); }
  level(wrist: Wrist | 'audition', gain: number, fadeSec: number) { this.send('/airkit/cos/level', [wrist, gain, fadeSec], 'sff'); }
  master(gain: number, fadeSec: number) { this.send('/airkit/cos/master', [gain, fadeSec], 'ff'); }
  audition(wrist: Wrist | null) { this.send('/airkit/cos/audition', wrist ? [wrist] : [], wrist ? 's' : ''); }
  panic() { this.send('/airkit/cos/panic'); }

  async waitReady(slot: number, patch: string, timeoutMs: number): Promise<boolean> {
    const t0 = this.clock();
    while (!this.closed && this.clock() - t0 < timeoutMs) {
      const st = await this.getStatus(Math.min(500, timeoutMs));
      const s = st?.slots?.[slot - 1];
      if (s && s.name === patch && s.ready) return true;
      await sleep(this.readyPollMs);
    }
    return false;
  }

  close() {
    if (this.sockClosed) return;
    this.closed = true;
    this.sockClosed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const w of this.waiters.splice(0)) { clearTimeout(w.timer); w.resolve(null); }
    this.sock.close();
  }
}
