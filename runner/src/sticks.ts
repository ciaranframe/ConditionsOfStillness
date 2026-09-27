// AirStick ingest: one UDP socket, /<id>/IMUFusedData (7 floats), /<id>/Battery, /<id>/DigiIn.
// Maps id -> wrist through cast.yaml; keeps a registry of every stick heard for Admin.
// Liveness is entirely ours (spec §5.1): the engine keeps ticking on frozen data.
import { createSocket, type Socket } from 'node:dgram';
import { flattenPacket } from '../../scripts/lib/osc.ts';
import { WRISTS, type Wrist } from './scenes.ts';
import { wristOfStickId, type Cast } from './cast.ts';
import { monotonicMs } from './clock.ts';

export const STICK_DEAD_MS = 1000;
export const BATTERY_LOW_PCT = 20;
const HEARD_FORGET_MS = 60_000;
const ADDR_RE = /^\/([A-Za-z0-9_-]+)\/(IMUFusedData|Battery|DigiIn)$/;

export interface HeardStick { id: string; ip: string; lastImuAt: number; ageMs: number; rateHz: number; batteryPct: number | null; volts: number | null; wrist: Wrist | null; conflict: boolean; packets: number }
export interface WristSignal { alive: boolean; ageMs: number; batteryPct: number | null; id: string | null; ip: string | null; label: string; ipMismatch: boolean }
export interface StickIngestOptions {
  port: number; bindAddress?: string; cast: () => Cast;
  onImu: (wrist: Wrist, floats: number[]) => void;
  onAux: (wrist: Wrist, kind: 'Battery' | 'DigiIn', args: number[]) => void;
  clock?: () => number; log?: (msg: string) => void;
}

interface Entry { id: string; ip: string; lastImuAt: number; stamps: number[]; batteryPct: number | null; volts: number | null; packets: number }
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

export class StickIngest {
  private opts: StickIngestOptions;
  private sock: Socket;
  private entries = new Map<string, Entry>();   // key `${id}@${ip}`
  private clock: () => number;
  private log: (msg: string) => void;
  private closed = false;
  constructor(opts: StickIngestOptions) {
    this.opts = opts;
    this.clock = opts.clock ?? monotonicMs;
    this.log = opts.log ?? console.log;
    this.sock = createSocket('udp4');
    this.sock.on('message', (buf, rinfo) => this.handlePacket(rinfo.address, Buffer.from(buf)));
    this.sock.on('error', (e) => this.log(`[sticks] socket error: ${String(e)}`));
  }
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      this.sock.once('error', onErr);
      this.sock.bind(this.opts.port, this.opts.bindAddress ?? '0.0.0.0', () => {
        this.sock.removeListener('error', onErr);
        this.log(`[sticks] listening on udp/${this.sock.address().port}`);
        resolve(this.sock.address().port);
      });
    });
  }
  /** Exposed so tests can present a second source IP. */
  handlePacket(ip: string, buf: Buffer): void {
    let msgs; try { msgs = flattenPacket(buf); } catch { return; }
    const now = this.clock();
    for (const m of msgs) {
      const hit = ADDR_RE.exec(m.address); if (!hit) continue;
      const [, id, kind] = hit as unknown as [string, string, 'IMUFusedData' | 'Battery' | 'DigiIn'];
      const key = `${id}@${ip}`;
      let e = this.entries.get(key);
      if (!e) { e = { id, ip, lastImuAt: -Infinity, stamps: [], batteryPct: null, volts: null, packets: 0 }; this.entries.set(key, e); this.log(`[sticks] heard stick ${id} from ${ip}`); }
      const wrist = wristOfStickId(this.opts.cast(), id);
      const args = m.args.map(num);
      if (kind === 'IMUFusedData') {
        if (args.length !== 7 || args.some((v) => !Number.isFinite(v))) continue;
        e.lastImuAt = now; e.packets++; e.stamps.push(now);
        while (e.stamps.length && e.stamps[0]! < now - 1000) e.stamps.shift();
        if (wrist) this.opts.onImu(wrist, args);
      } else if (kind === 'Battery') {
        if (args.length >= 2 && Number.isFinite(args[1])) { e.volts = args[0]!; e.batteryPct = Math.round(args[1]! <= 1 ? args[1]! * 100 : args[1]!); }
        if (wrist) this.opts.onAux(wrist, 'Battery', args);
      } else if (wrist) this.opts.onAux(wrist, 'DigiIn', args);
    }
  }
  private live(): Entry[] {
    const now = this.clock();
    for (const [k, e] of this.entries) if (now - e.lastImuAt > HEARD_FORGET_MS && e.lastImuAt !== -Infinity) this.entries.delete(k);
    return [...this.entries.values()];
  }
  heard(): HeardStick[] {
    const now = this.clock(), cast = this.opts.cast(), all = this.live();
    const byId = new Map<string, Entry[]>();
    for (const e of all) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
    return all.map((e) => ({
      id: e.id, ip: e.ip, lastImuAt: e.lastImuAt, ageMs: now - e.lastImuAt, rateHz: e.stamps.length, batteryPct: e.batteryPct, volts: e.volts,
      wrist: wristOfStickId(cast, e.id), packets: e.packets,
      conflict: (byId.get(e.id) ?? []).filter((x) => now - x.lastImuAt <= STICK_DEAD_MS).length > 1,
    })).sort((a, b) => a.lastImuAt - b.lastImuAt).reverse();
  }
  wrists(): Record<Wrist, WristSignal> {
    const now = this.clock(), cast = this.opts.cast(), all = this.live();
    const out = {} as Record<Wrist, WristSignal>;
    for (const w of WRISTS) {
      const c = cast.sticks[w];
      const es = c.id === null ? [] : all.filter((e) => e.id === c.id).sort((a, b) => b.lastImuAt - a.lastImuAt);
      const e = es[0];
      const ageMs = e ? now - e.lastImuAt : Infinity;
      out[w] = { alive: ageMs <= STICK_DEAD_MS, ageMs, batteryPct: e?.batteryPct ?? null, id: c.id, ip: e?.ip ?? null, label: c.label, ipMismatch: !!(e && c.ip && c.ip !== e.ip) };
    }
    return out;
  }
  aliveCount(): number { return Object.values(this.wrists()).filter((s) => s.alive).length; }
  close(): void { if (this.closed) return; this.closed = true; this.sock.close(); }
}
