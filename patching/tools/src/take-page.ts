// Take page: a standalone recording desk for wrist takes. One UDP socket hears every stick
// that streams to it (id, ip, rate, battery, live acceleration) between takes; one HTTP server
// serves `public/take.html` and a small JSON API the page polls. Recording goes through
// `startTakeSession` (src/take.ts), so a page take is byte-for-byte what `take-record.ts`
// writes: `takes/<label>.take.jsonl` + an INDEX.md row.
//
// Planned takes: `takes/PLAN.md` holds a `| label | what |` table Ciaran and Claude write as
// the gestures are dictated; the page lists it, ticks the labels that already have a take,
// and arms the next one. Filing: every take from this page is filed under `as` (default `CF`)
// unless the request names a wrist.
//
// The Glimmer C-stick firmware streams to a fixed address on udp 9000 (root README, "Recording
// a take"), so 9000 is the default UDP port; the runner's 8000 is the alternative when the
// runner is stopped.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createSocket, type Socket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenPacket } from '../../../scripts/lib/osc.ts';
import { WRISTS, type Wrist } from '../../../runner/src/scenes.ts';
import { parseTakeIndex } from '../../../runner/src/replay.ts';
import { repoRoot } from './sc.ts';
import { LABEL_RE, startTakeSession, takePath, type TakeResult, type TakeSession } from './take.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');
const RUNNER_PUBLIC = join(HERE, '..', '..', '..', 'runner', 'public');
const ADDR_RE = /^\/([A-Za-z0-9_-]+)\/(IMUFusedData|Battery)$/;
const HEARD_FORGET_MS = 60_000;
const STICK_DEAD_MS = 1000;

export interface TakePageOptions {
  udpPort?: number;
  webPort?: number;
  bindAddress?: string;
  /** Takes directory (default `<repo>/takes`); PLAN.md and INDEX.md live in it. */
  out?: string;
  /** Default filing label for takes recorded from the page (default `CF`). */
  as?: string;
  clock?: () => number;
  streamEndMs?: number;
  log?: (line: string) => void;
}

export interface HeardStick {
  id: string; ip: string; alive: boolean; ageMs: number; rateHz: number; packets: number;
  batteryPct: number | null; volts: number | null;
  /** Last linear acceleration [x, y, z] and its magnitude, for the page's live readout. */
  a: [number, number, number] | null; mag: number | null;
}
export interface PlanItem { label: string; what: string; done: boolean }
export interface TakeRow { label: string; wrist: string; date: string; seconds: string; what: string }
export interface RecordingView { label: string; what: string; id: string; as: string; startedAt: string; elapsedSec: number; rows: number }
export interface PageState {
  udpPort: number; as: string; out: string;
  heard: HeardStick[];
  recording: RecordingView | null;
  last: (TakeResult & { label: string }) | null;
  takes: TakeRow[];
  plan: PlanItem[];
  planPath: string;
}
export interface RecordRequest { label: string; what?: string; id: string; as?: string; wrist?: Wrist; force?: boolean }
export interface TakePage { udpPort: number; webPort: number; state: () => PageState; record: (r: RecordRequest) => void; stop: () => Promise<TakeResult | null>; close: () => Promise<void> }

interface Entry { id: string; ip: string; lastImuAt: number; lastSeenAt: number; stamps: number[]; packets: number; batteryPct: number | null; volts: number | null; a: [number, number, number] | null }

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : NaN);

/** Parses `takes/PLAN.md`: every `| label | what |` table row (the header row and `|---|`
 * separators skipped, a label that fails LABEL_RE skipped). Pure; exported for tests. */
export function parsePlan(text: string): Array<{ label: string; what: string }> {
  const out: Array<{ label: string; what: string }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 1) continue;
    const label = cells[0]!;
    if (label === 'label' || /^:?-+:?$/.test(label) || !LABEL_RE.test(label)) continue;
    out.push({ label, what: cells[1] ?? '' });
  }
  return out;
}

/** `takes/INDEX.md` rows — the runner's parser (runner/src/replay.ts), re-exported for the page. */
export const parseIndex = (text: string): TakeRow[] => parseTakeIndex(text);

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 64 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(new Error('body is not JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain' };

function serveFile(res: ServerResponse, path: string): void {
  if (!existsSync(path)) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.slice(path.lastIndexOf('.'));
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(path));
}

export async function startTakePage(opts: TakePageOptions = {}): Promise<TakePage> {
  const clock = opts.clock ?? Date.now;
  const log = opts.log ?? ((l: string) => console.error(l));
  const out = opts.out ?? join(repoRoot(), 'takes');
  const as = opts.as ?? 'CF';
  if (!LABEL_RE.test(as)) throw new Error(`take-page: filing label ${JSON.stringify(as)} must match ${LABEL_RE}`);
  const planPath = join(out, 'PLAN.md');
  const indexPath = join(out, 'INDEX.md');

  const entries = new Map<string, Entry>();
  let recording: { session: TakeSession; label: string; what: string; id: string; as: string } | null = null;
  let last: (TakeResult & { label: string }) | null = null;

  // ── UDP: hear every stick, feed the live take ──────────────────────────────────────────────
  const sock: Socket = createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    sock.once('error', reject);
    sock.bind(opts.udpPort ?? 9000, opts.bindAddress ?? '0.0.0.0', () => { sock.removeAllListeners('error'); resolve(); });
  });
  sock.on('error', () => {});
  const udpPort = (sock.address() as { port: number }).port;

  sock.on('message', (buf, rinfo) => {
    if (recording) recording.session.push(buf);
    let msgs; try { msgs = flattenPacket(buf); } catch { return; }
    const now = clock();
    for (const m of msgs) {
      const hit = ADDR_RE.exec(m.address); if (!hit) continue;
      const id = hit[1]!; const kind = hit[2]!;
      const key = `${id}@${rinfo.address}`;
      let e = entries.get(key);
      if (!e) { e = { id, ip: rinfo.address, lastImuAt: -Infinity, lastSeenAt: now, stamps: [], packets: 0, batteryPct: null, volts: null, a: null }; entries.set(key, e); log(`[take-page] heard stick ${id} from ${rinfo.address}`); }
      e.lastSeenAt = now;
      const args = m.args.map(num);
      if (kind === 'IMUFusedData') {
        if (args.length !== 7 || args.some((v) => !Number.isFinite(v))) continue;
        e.lastImuAt = now; e.packets++; e.stamps.push(now);
        while (e.stamps.length && e.stamps[0]! < now - 1000) e.stamps.shift();
        e.a = [args[0]!, args[1]!, args[2]!];
      } else if (args.length >= 2 && Number.isFinite(args[1])) {
        e.volts = args[0]!; e.batteryPct = Math.round(args[1]! <= 1 ? args[1]! * 100 : args[1]!);
      }
    }
  });

  function heard(): HeardStick[] {
    const now = clock();
    for (const [k, e] of entries) if (now - e.lastSeenAt > HEARD_FORGET_MS) entries.delete(k);
    return [...entries.values()]
      .sort((x, y) => y.lastImuAt - x.lastImuAt)
      .map((e) => {
        const ageMs = now - e.lastImuAt;
        const recent = e.stamps.filter((t) => t >= now - 1000).length;
        return {
          id: e.id, ip: e.ip, alive: ageMs <= STICK_DEAD_MS, ageMs: Number.isFinite(ageMs) ? ageMs : -1, rateHz: recent, packets: e.packets,
          batteryPct: e.batteryPct, volts: e.volts, a: e.a, mag: e.a ? Math.hypot(e.a[0], e.a[1], e.a[2]) : null,
        };
      });
  }

  function plan(): PlanItem[] {
    if (!existsSync(planPath)) return [];
    return parsePlan(readFileSync(planPath, 'utf8')).map((p) => ({ ...p, done: existsSync(takePath(p.label, out)) }));
  }
  function takes(): TakeRow[] {
    if (!existsSync(indexPath)) return [];
    return parseIndex(readFileSync(indexPath, 'utf8')).reverse();
  }

  function state(): PageState {
    const now = clock();
    return {
      udpPort, as, out, heard: heard(),
      recording: recording ? {
        label: recording.label, what: recording.what, id: recording.id, as: recording.as,
        startedAt: new Date(recording.session.startedAtMs).toISOString(),
        elapsedSec: Math.max(0, (now - recording.session.startedAtMs) / 1000), rows: recording.session.rows(),
      } : null,
      last, takes: takes(), plan: plan(), planPath,
    };
  }

  function record(r: RecordRequest): void {
    if (recording) throw new Error(`already recording ${recording.label}`);
    if (typeof r.label !== 'string' || !LABEL_RE.test(r.label)) throw new Error('label must be letters, digits, _ . - only');
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(r.id)) throw new Error('pick a stick id');
    if (r.wrist !== undefined && !(WRISTS as readonly string[]).includes(r.wrist)) throw new Error(`wrist must be one of ${WRISTS.join(', ')}`);
    const filing = r.as ?? as;
    const what = typeof r.what === 'string' ? r.what.trim() : '';
    const session = startTakeSession({ id: r.id, label: r.label, what, out, as: r.wrist ? undefined : filing, wrist: r.wrist, force: !!r.force, clock, streamEndMs: opts.streamEndMs });
    const label = r.label;
    recording = { session, label, what, id: r.id, as: r.wrist ?? filing };
    log(`[take-page] REC ${label} (${r.id} as ${recording.as})`);
    void session.done.then((result) => {
      if (recording?.session === session) recording = null;
      last = { ...result, label };
      log(`[take-page] ${result.written ? `${result.rows} rows -> ${result.path}` : `${label}: no packets, nothing written`} (${result.reason})`);
    });
  }

  async function stop(): Promise<TakeResult | null> {
    if (!recording) return null;
    const { session } = recording;
    session.stop();
    return session.done;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────────────────────
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/take')) return serveFile(res, join(PUBLIC, 'take.html'));
      if (req.method === 'GET' && url.pathname === '/fonts.css') return serveFile(res, join(RUNNER_PUBLIC, 'fonts.css'));
      if (req.method === 'GET' && /^\/fonts\/[A-Za-z0-9._-]+$/.test(url.pathname)) return serveFile(res, join(RUNNER_PUBLIC, url.pathname.slice(1)));
      if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state());
      if (req.method === 'POST' && url.pathname === '/api/record') {
        const body = await readJson(req);
        try { record(body as RecordRequest); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
        return send(res, 200, { ok: true, recording: state().recording });
      }
      if (req.method === 'POST' && url.pathname === '/api/stop') {
        const result = await stop();
        return send(res, 200, { ok: true, result });
      }
      res.writeHead(404); res.end('not found');
    } catch (e) {
      send(res, 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.webPort ?? 3001, opts.bindAddress ?? '0.0.0.0', () => { server.removeAllListeners('error'); resolve(); });
  });
  const webPort = (server.address() as { port: number }).port;

  async function close(): Promise<void> {
    await stop();
    sock.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { udpPort, webPort, state, record, stop, close };
}
