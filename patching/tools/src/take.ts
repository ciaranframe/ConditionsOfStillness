// Take recorder (ruling 4). A *session* buffers one stick's `/<id>/IMUFusedData` rows in memory
// (a take is minutes at ~100 Hz: fine) from whatever packets are pushed into it — everything
// else (other ids, other addresses, malformed args) is ignored — until it stops, then writes
// `takes/<label>.take.jsonl` atomically and appends a row to `takes/INDEX.md`.
//
// `recordTake` is the CLI shape: it binds a UDP port and pushes every datagram into a session.
// `take-page.ts` owns its own socket (it also watches sticks between takes) and pushes packets
// into a session itself.
//
// A session stops on `seconds` elapsed, on `stop()` (the CLI wires this to SIGINT), or — when
// the stream goes quiet for `streamEndMs` (default 5 s) after at least one packet — closes
// cleanly with the rows so far and notes "(stream ended)" in the INDEX row (Review Focus 4).
//
// Safeguards: the label must match LABEL_RE (it is a file name and an INDEX.md table cell); an
// existing take of that label is refused unless `force` (which replaces the file and its INDEX
// row); if no packet has arrived `noPacketWarnMs` (default 3 s) after binding, `recordTake`'s
// `warn` says where it is listening; a take that ends with 0 rows writes nothing — no take file,
// no INDEX row — and reports `written: false`.
//
// Filing: the INDEX "wrist" column is the wrist when one was given, else `as` (a filing label
// such as `CF` for takes Ciaran records on his own wrist with an unassigned stick), else the id.
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flattenPacket, type OscMessage } from '../../../scripts/lib/osc.ts';
import { parseCast } from '../../../runner/src/cast.ts';
import { WRISTS, type Wrist } from '../../../runner/src/scenes.ts';
import { writeAtomic } from './atomic.ts';
import { repoRoot } from './sc.ts';

export interface TakeSessionOptions {
  /** The stick's OSC id: only `/<id>/IMUFusedData` is recorded. */
  id: string;
  /** Filed under this wrist (INDEX column and header) when given. */
  wrist?: Wrist;
  /** Filing label for a take not tied to a performer wrist (e.g. `CF`); must match LABEL_RE. */
  as?: string;
  label: string;
  seconds?: number;
  out?: string;
  what?: string;
  /** Overrides Date.now() for startedAt/t (tests only; production leaves this default). */
  clock?: () => number;
  /** How long the stream may go quiet (after at least one packet) before closing cleanly.
   * Default 5000ms; tests inject something shorter so they don't have to wait 5 real seconds. */
  streamEndMs?: number;
  /** Replace an existing take (and its INDEX.md row) of the same label. */
  force?: boolean;
}

export interface RecordTakeOptions extends Omit<TakeSessionOptions, 'id'> {
  port?: number;
  id?: string;
  castPath?: string;
  /** Called once if no packet has arrived this long after binding (default 3000 ms). */
  noPacketWarnMs?: number;
  warn?: (message: string) => void;
}

export type StopReason = 'seconds' | 'stop' | 'stream-ended';
/** `written` is false (and neither the take file nor an INDEX row was written) when the take
 * ended with 0 rows. */
export interface TakeResult { path: string; rows: number; reason: StopReason; hz: number; written: boolean }

/** A take label: letters, digits, `_`, `.`, `-` (so it is safe as a file name and as a table
 * cell — no `|`, no `/`). */
export const LABEL_RE = /^[A-Za-z0-9_.-]+$/;

export function takePath(label: string, out = join(repoRoot(), 'takes')): string {
  return join(out, `${label}.take.jsonl`);
}
export interface TakeSession {
  push: (buf: Buffer) => void;
  stop: () => void;
  done: Promise<TakeResult>;
  /** Rows buffered so far (live, for a page's counter). */
  rows: () => number;
  startedAtMs: number;
  path: string;
}
export interface TakeHandle extends TakeSession { port: number }

interface Row { t: number; a: [number, number, number]; q: [number, number, number, number] }

const INDEX_HEADER = `# Recorded wrist takes

Raw OSC from one wrist, timestamped, replayable by \`patching/tools/patch-audition.ts\`.
Files are \`takes/<label>.take.jsonl\` (gitignored). \`take-record.ts\` appends a row here.

| label | wrist | date | seconds | what |
|---|---|---|---|---|
`;

function resolveId(opts: RecordTakeOptions): string {
  if (opts.id !== undefined) return opts.id;
  if (opts.wrist === undefined) throw new Error('recordTake: need id or wrist');
  if (!(WRISTS as readonly string[]).includes(opts.wrist)) {
    throw new Error(`recordTake: unknown wrist ${JSON.stringify(opts.wrist)} (expected one of ${WRISTS.join(', ')})`);
  }
  const castPath = opts.castPath ?? join(repoRoot(), 'scenes', 'cast.yaml');
  let text: string;
  try {
    text = readFileSync(castPath, 'utf8');
  } catch {
    throw new Error(`recordTake: cannot read cast file ${castPath}`);
  }
  const { cast } = parseCast(text);
  const id = cast.sticks[opts.wrist].id;
  if (id === null) throw new Error(`recordTake: wrist ${opts.wrist} has no stick id assigned in ${castPath}`);
  return id;
}

/** Appends `row`; with `replaceLabel`, first drops any existing row for that label (a forced
 * re-record keeps one row per take). */
function appendIndexRow(indexPath: string, row: string, replaceLabel?: string): void {
  let text = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : INDEX_HEADER;
  if (replaceLabel !== undefined) {
    text = text.split('\n').filter((l) => !l.startsWith(`| ${replaceLabel} |`)).join('\n');
  }
  if (!text.endsWith('\n')) text += '\n';
  writeAtomic(indexPath, text + row + '\n');
}

/** Starts buffering rows for one stick. Packets arrive through `push`; nothing is bound here.
 * Throws synchronously on a bad label / filing label or an existing take without `force`. */
export function startTakeSession(opts: TakeSessionOptions): TakeSession {
  if (!LABEL_RE.test(opts.label)) {
    throw new Error(`take: label ${JSON.stringify(opts.label)} must match ${LABEL_RE} (letters, digits, _ . -)`);
  }
  if (opts.as !== undefined && !LABEL_RE.test(opts.as)) {
    throw new Error(`take: filing label ${JSON.stringify(opts.as)} must match ${LABEL_RE} (letters, digits, _ . -)`);
  }
  if (opts.wrist !== undefined && !(WRISTS as readonly string[]).includes(opts.wrist)) {
    throw new Error(`take: unknown wrist ${JSON.stringify(opts.wrist)} (expected one of ${WRISTS.join(', ')})`);
  }
  const outDir = opts.out ?? join(repoRoot(), 'takes');
  const path = takePath(opts.label, outDir);
  const existed = existsSync(path);
  if (existed && !opts.force) {
    throw new Error(`take: a take labelled ${opts.label} already exists (${path}); pick another label or pass force (--force)`);
  }
  const id = opts.id;
  const clock = opts.clock ?? Date.now;
  const streamEndMs = opts.streamEndMs ?? 5000;
  const indexPath = join(outDir, 'INDEX.md');
  const expectedAddress = `/${id}/IMUFusedData`;

  const startedAtMs = clock();
  const rows: Row[] = [];
  let firstPacketMs: number | null = null;
  let finished = false;
  let secondsTimer: NodeJS.Timeout | undefined;
  let watchdog: NodeJS.Timeout | undefined;
  const { promise: done, resolve: resolveDone } = Promise.withResolvers<TakeResult>();

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => finish('stream-ended'), streamEndMs);
    watchdog.unref();
  };

  function finish(reason: StopReason): void {
    if (finished) return;
    finished = true;
    if (secondsTimer) clearTimeout(secondsTimer);
    if (watchdog) clearTimeout(watchdog);

    const elapsedSec = Math.max(0, (clock() - startedAtMs) / 1000);
    let hz = 0;
    if (rows.length >= 2) {
      const durationSec = (rows[rows.length - 1]!.t - rows[0]!.t) / 1000;
      hz = durationSec > 0 ? Math.round((rows.length - 1) / durationSec) : rows.length;
    }

    if (rows.length === 0) {
      // nothing heard: no take file, no INDEX row (an existing take of this label is untouched)
      resolveDone({ path, rows: 0, reason, hz: 0, written: false });
      return;
    }

    const header = { label: opts.label, wrist: opts.wrist ?? null, as: opts.as ?? null, id, startedAt: new Date(startedAtMs).toISOString(), hz };
    const lines = [JSON.stringify(header), ...rows.map((r) => JSON.stringify(r))];
    writeAtomic(path, lines.join('\n') + '\n');

    const date = header.startedAt.slice(0, 10);
    const whatNote = (opts.what ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');   // a table cell
    const what = reason === 'stream-ended' ? `${whatNote}${whatNote ? ' ' : ''}(stream ended)` : whatNote;
    const who = opts.wrist ?? opts.as ?? id;
    appendIndexRow(indexPath, `| ${opts.label} | ${who} | ${date} | ${elapsedSec.toFixed(1)} | ${what} |`, existed ? opts.label : undefined);

    resolveDone({ path, rows: rows.length, reason, hz, written: true });
  }

  function push(buf: Buffer): void {
    if (finished) return;
    let messages: OscMessage[];
    try {
      messages = flattenPacket(buf);
    } catch {
      return;
    }
    for (const m of messages) {
      if (m.address !== expectedAddress) continue;
      if (m.args.length !== 7 || !m.args.every((a) => typeof a === 'number' && Number.isFinite(a))) continue;
      const args = m.args as number[];
      const now = clock();
      if (firstPacketMs === null) firstPacketMs = now;
      rows.push({ t: Math.round(now - firstPacketMs), a: [args[0]!, args[1]!, args[2]!], q: [args[3]!, args[4]!, args[5]!, args[6]!] });
      armWatchdog();
    }
  }

  if (opts.seconds !== undefined) {
    secondsTimer = setTimeout(() => finish('seconds'), opts.seconds * 1000);
    secondsTimer.unref();
  }

  return { push, stop: () => finish('stop'), done, rows: () => rows.length, startedAtMs, path };
}

/** Binds a UDP port and records one take from it (the CLI shape). */
export async function recordTake(opts: RecordTakeOptions): Promise<TakeHandle> {
  const id = resolveId(opts);
  const session = startTakeSession({ ...opts, id });
  const warn = opts.warn ?? ((m: string) => console.error(`take-record: ${m}`));

  const sock = createSocket('udp4');
  await new Promise<void>((resolve, reject) => {
    const onError = (e: Error) => reject(e);
    sock.once('error', onError);
    sock.bind(opts.port ?? 8001, () => {
      sock.removeListener('error', onError);
      resolve();
    });
  });
  sock.on('error', () => {}); // a socket error after bind must not crash the process (fake-sticks.ts does the same)
  const boundPort = (sock.address() as { port: number }).port;

  const noPacketTimer: NodeJS.Timeout = setTimeout(() => {
    if (session.rows() === 0) {
      warn(`waiting for /${id}/IMUFusedData on udp ${boundPort} — is the stick streaming here? (AirKit sticks: repoint with /Config/RequestStream, or stop the runner; the Glimmer C-stick build sends to a fixed address on 9000)`);
    }
  }, opts.noPacketWarnMs ?? 3000);
  noPacketTimer.unref();

  sock.on('message', (buf) => session.push(buf));
  const done = session.done.then((r) => {
    clearTimeout(noPacketTimer);
    sock.close();
    return r;
  });

  return { ...session, done, port: boundPort };
}
