// The footswitch. MIDI → 'next' | 'back' through cast.yaml's pedal mapping. The device layer
// is thin and optional; the mapping is pure and tested. Pattern from Glimmer's src/midi/midi.ts.
import type { Cast, PedalTrigger } from './cast.ts';
import { monotonicMs } from './clock.ts';

export interface MidiEvent { type: 'note' | 'cc'; number: number; value: number; channel: number }
export type PedalAction = 'next' | 'back';
export interface PedalStatus { state: 'OK' | 'NO PEDAL' | 'NO MIDI'; port: string | null; lastEvent: { desc: string; at: number } | null }

export function parseMidi(msg: number[]): MidiEvent | null {
  const [status = 0, d1 = 0, d2 = 0] = msg; const type = status & 0xf0, channel = (status & 0x0f) + 1;
  if (type === 0x90 && d2 > 0) return { type: 'note', number: d1, value: d2, channel };
  if (type === 0xb0) return { type: 'cc', number: d1, value: d2, channel };
  return null;
}
export function matchTrigger(ev: MidiEvent, t: PedalTrigger): boolean {
  if (t.note !== undefined) return ev.type === 'note' && ev.number === t.note;
  if (t.cc !== undefined) return ev.type === 'cc' && ev.number === t.cc && ev.value >= 64;
  return false;
}

export class PedalMapper {
  lastEvent: { desc: string; at: number } | null = null;
  private lastAt: Record<PedalAction, number> = { next: -Infinity, back: -Infinity };
  private clock: () => number;
  private opts: { cast: () => Cast; onCue: (a: PedalAction) => void; clock?: () => number };
  constructor(opts: { cast: () => Cast; onCue: (a: PedalAction) => void; clock?: () => number }) {
    this.opts = opts;
    this.clock = opts.clock ?? monotonicMs;
  }
  feed(msg: number[]): string | null {
    const ev = parseMidi(msg); if (!ev) return null;
    const p = this.opts.cast().pedal; const now = this.clock();
    let desc = `${ev.type} ${ev.number} ${ev.type === 'note' ? 'vel' : '='} ${ev.value} ch ${ev.channel}`;
    if (p.channel && ev.channel !== p.channel) desc += ' (wrong channel)';
    else {
      const action: PedalAction | null = matchTrigger(ev, p.next) ? 'next' : matchTrigger(ev, p.back) ? 'back' : null;
      if (!action) desc += ' (unmapped)';
      else if (now - this.lastAt[action] < p.debounceMs) desc += ` → ${action} (debounced)`;
      else { this.lastAt[action] = now; desc += ` → ${action}`; this.opts.onCue(action); }
    }
    this.lastEvent = { desc, at: now };
    return desc;
  }
}

export interface MidiInputLike { getPortCount(): number; getPortName(i: number): string; openPort(i: number): void; closePort(): void; ignoreTypes(a: boolean, b: boolean, c: boolean): void; on(ev: 'message', cb: (dt: number, msg: number[]) => void): void }

const SCAN_ERROR_LOG_MS = 30_000;

export async function startPedal(opts: { cast: () => Cast; onCue: (a: PedalAction) => void; log: (m: string) => void; clock?: () => number; rescanMs?: number; midi?: { Input: new () => MidiInputLike } }): Promise<{ status(): PedalStatus; close(): void }> {
  const mapper = new PedalMapper(opts);
  const clock = opts.clock ?? monotonicMs;
  let Input: (new () => MidiInputLike) | null = null;
  if (opts.midi) Input = opts.midi.Input;
  else {
    try { Input = ((await import('@julusian/midi')) as unknown as { Input: new () => MidiInputLike }).Input; }
    catch (e) { opts.log(`[pedal] MIDI unavailable (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`); }
  }
  let input: MidiInputLike | null = null; let portName: string | null = null; let timer: ReturnType<typeof setInterval> | null = null;
  let lastScanErrorAt = -Infinity;
  // The native binding can throw at any of these calls (unplug mid-call, a flaky adapter's driver, …);
  // the pedal is optional, so a scan failure must never take the whole runner down with it.
  const scan = () => {
    if (!Input) return;
    try {
      const probe = new Input(); const names = Array.from({ length: probe.getPortCount() }, (_, i) => probe.getPortName(i)); probe.closePort();
      if (input) { if (!names.includes(portName!)) { opts.log(`[pedal] "${portName}" disappeared`); input.closePort(); input = null; portName = null; } return; }
      const want = opts.cast().pedal.input?.toLowerCase() ?? null;
      const idx = want ? names.findIndex((n) => n.toLowerCase().includes(want)) : names.length ? 0 : -1;
      if (idx < 0) return;
      input = new Input(); input.ignoreTypes(true, true, true);
      input.on('message', (_dt, msg) => { const d = mapper.feed(msg); if (d) opts.log(`[pedal] ${d}`); });
      input.openPort(idx); portName = names[idx]!; opts.log(`[pedal] listening on "${portName}"`);
    } catch (e) {
      const now = clock();
      if (now - lastScanErrorAt >= SCAN_ERROR_LOG_MS) {
        opts.log(`[pedal] scan failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
        lastScanErrorAt = now;
      }
      if (input) { try { input.closePort(); } catch { /* already gone */ } }
      input = null; portName = null;
    }
  };
  scan();
  if (Input) { timer = setInterval(scan, opts.rescanMs ?? 5000); timer.unref(); }
  return {
    status: (): PedalStatus => ({ state: !Input ? 'NO MIDI' : input ? 'OK' : 'NO PEDAL', port: portName, lastEvent: mapper.lastEvent }),
    close: () => { if (timer) clearInterval(timer); try { input?.closePort(); } catch { /* already gone */ } },
  };
}
