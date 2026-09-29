// Take replay: plays a recorded wrist take (`takes/<label>.take.jsonl`, written by the take page
// or take-record.ts) into one wrist as if its stick were streaming it, so a patch can be tested
// against a real gesture from Admin without anyone wearing a stick. Rows are pushed through the
// same `onImu(wrist, floats)` path as the stick ingest; while a wrist is replayed, its real
// stick (if any) is muted by main.ts so the two do not interleave.
//
// One replay at a time. A take ends → stops (or restarts, with `loop`). `stop()` leaves the
// patch on the take's last pose; the real stick takes over again with its next packet.
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WRISTS, type Wrist } from './scenes.ts';
import { monotonicMs } from './clock.ts';

export const TAKE_LABEL_RE = /^[A-Za-z0-9_.-]+$/;
const TICK_MS = 5;

export interface TakeInfo { label: string; wrist: string; date: string; seconds: string; what: string; exists: boolean }
export interface ReplayState { label: string; wrist: Wrist; loop: boolean; elapsedSec: number; seconds: number; rows: number; row: number }
export interface ReplayOptions { takesDir: string; onImu: (wrist: Wrist, floats: number[]) => void; log?: (line: string, level?: 'warn' | 'error') => void; clock?: () => number }

interface Row { t: number; floats: number[] }

/** Parses `takes/INDEX.md` (the five-column table take.ts appends to). Pure. */
export function parseTakeIndex(text: string): Array<Omit<TakeInfo, 'exists'>> {
  const out: Array<Omit<TakeInfo, 'exists'>> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    const label = cells[0]!;
    if (label === 'label' || /^:?-+:?$/.test(label) || !TAKE_LABEL_RE.test(label)) continue;
    out.push({ label, wrist: cells[1]!, date: cells[2]!, seconds: cells[3]!, what: cells[4]! });
  }
  return out;
}

/** Parses a take file into rows (`{t, a, q}` lines; the header and malformed lines dropped). Pure. */
export function parseTakeRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj !== 'object' || obj === null) continue;
    const o = obj as { t?: unknown; a?: unknown; q?: unknown };
    if (!Array.isArray(o.a) || !Array.isArray(o.q) || o.a.length !== 3 || o.q.length !== 4 || typeof o.t !== 'number') continue;
    const floats = [...o.a, ...o.q];
    if (!floats.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    rows.push({ t: o.t, floats: floats as number[] });
  }
  return rows;
}

export class Replay extends EventEmitter {
  private current: { label: string; wrist: Wrist; loop: boolean; rows: Row[]; startedAt: number; next: number; timer: ReturnType<typeof setInterval> } | null = null;
  private readonly clock: () => number;
  private readonly opts: ReplayOptions;
  constructor(opts: ReplayOptions) { super(); this.opts = opts; this.clock = opts.clock ?? monotonicMs; }

  private log(line: string, level?: 'warn' | 'error') { this.opts.log?.(line, level); }

  /** Every take INDEX.md lists, newest last, with whether its file is present. */
  list(): TakeInfo[] {
    const indexPath = join(this.opts.takesDir, 'INDEX.md');
    if (!existsSync(indexPath)) return [];
    let text: string;
    try { text = readFileSync(indexPath, 'utf8'); } catch { return []; }
    return parseTakeIndex(text).map((t) => ({ ...t, exists: existsSync(join(this.opts.takesDir, `${t.label}.take.jsonl`)) }));
  }

  active(wrist: Wrist): boolean { return this.current?.wrist === wrist; }

  state(): ReplayState | null {
    const c = this.current;
    if (!c) return null;
    const seconds = c.rows.length ? c.rows[c.rows.length - 1]!.t / 1000 : 0;
    return { label: c.label, wrist: c.wrist, loop: c.loop, elapsedSec: Math.min(seconds, (this.clock() - c.startedAt) / 1000), seconds, rows: c.rows.length, row: c.next };
  }

  /** Starts `label` on `wrist`, replacing any replay in progress. Throws when the take is missing or empty. */
  play(label: string, wrist: Wrist, loop = false): void {
    if (!TAKE_LABEL_RE.test(label)) throw new Error(`replay: bad take label ${JSON.stringify(label)}`);
    if (!(WRISTS as readonly string[]).includes(wrist)) throw new Error(`replay: unknown wrist ${JSON.stringify(wrist)}`);
    const path = join(this.opts.takesDir, `${label}.take.jsonl`);
    if (!existsSync(path)) throw new Error(`replay: no take file ${path}`);
    const rows = parseTakeRows(readFileSync(path, 'utf8'));
    if (rows.length === 0) throw new Error(`replay: ${label} has no rows`);
    this.stop(true);
    const timer = setInterval(() => this.tick(), TICK_MS);
    timer.unref();
    this.current = { label, wrist, loop, rows, startedAt: this.clock(), next: 0, timer };
    this.log(`replay: ${label} → ${wrist} (${(rows[rows.length - 1]!.t / 1000).toFixed(1)} s, ${rows.length} rows${loop ? ', loop' : ''})`);
    this.tick();
    this.emit('change');
  }

  private tick(): void {
    const c = this.current;
    if (!c) return;
    const elapsed = this.clock() - c.startedAt;
    while (c.next < c.rows.length && c.rows[c.next]!.t <= elapsed) {
      this.opts.onImu(c.wrist, c.rows[c.next]!.floats);
      c.next++;
    }
    if (c.next >= c.rows.length) {
      if (c.loop) { c.startedAt = this.clock(); c.next = 0; return; }
      this.stop();
    }
  }

  stop(quiet = false): void {
    const c = this.current;
    if (!c) return;
    clearInterval(c.timer);
    this.current = null;
    if (!quiet) { this.log(`replay: ${c.label} on ${c.wrist} ${c.next >= c.rows.length ? 'finished' : 'stopped'}`); this.emit('change'); }
  }

  dispose(): void { this.stop(true); }
}
