// Take recorder (ruling 4). Binds a UDP port, listens for one stick's `/<id>/IMUFusedData`
// packets only (everything else — other ids, other addresses, malformed args — is ignored),
// and buffers rows in memory (a take is minutes at ~100 Hz: fine) until it stops, then writes
// `takes/<label>.take.jsonl` atomically and appends a row to `takes/INDEX.md`.
//
// Stops on `seconds` elapsed, on `stop()` (the CLI wires this to SIGINT), or — when the stream
// goes quiet for `streamEndMs` (default 5 s) after at least one packet — closes cleanly with the
// rows so far and notes "(stream ended)" in the INDEX row (Review Focus 4).
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flattenPacket, type OscMessage } from '../../../scripts/lib/osc.ts';
import { parseCast } from '../../../runner/src/cast.ts';
import type { Wrist } from '../../../runner/src/scenes.ts';
import { writeAtomic } from './atomic.ts';
import { repoRoot } from './sc.ts';

export interface RecordTakeOptions {
  port?: number;
  id?: string;
  wrist?: Wrist;
  label: string;
  seconds?: number;
  out?: string;
  what?: string;
  castPath?: string;
  /** Overrides Date.now() for startedAt/t (tests only; production leaves this default). */
  clock?: () => number;
  /** How long the stream may go quiet (after at least one packet) before closing cleanly.
   * Default 5000ms; tests inject something shorter so they don't have to wait 5 real seconds. */
  streamEndMs?: number;
}

export type StopReason = 'seconds' | 'stop' | 'stream-ended';
export interface TakeResult { path: string; rows: number; reason: StopReason; hz: number }
export interface TakeHandle { port: number; stop: () => void; done: Promise<TakeResult> }

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
  const castPath = opts.castPath ?? join(repoRoot(), 'scenes', 'cast.yaml');
  let text: string;
  try {
    text = readFileSync(castPath, 'utf8');
  } catch {
    throw new Error(`recordTake: cannot read cast file ${castPath}`);
  }
  const { cast } = parseCast(text);
  const id = cast.sticks[opts.wrist].id;
  if (id === null) throw new Error(`recordTake: wrist ${opts.wrist} has no assigned stick id in ${castPath}`);
  return id;
}

function appendIndexRow(indexPath: string, row: string): void {
  let text = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : INDEX_HEADER;
  if (!text.endsWith('\n')) text += '\n';
  writeAtomic(indexPath, text + row + '\n');
}

export async function recordTake(opts: RecordTakeOptions): Promise<TakeHandle> {
  const id = resolveId(opts);
  const clock = opts.clock ?? Date.now;
  const streamEndMs = opts.streamEndMs ?? 5000;
  const outDir = opts.out ?? join(repoRoot(), 'takes');
  const takePath = join(outDir, `${opts.label}.take.jsonl`);
  const indexPath = join(outDir, 'INDEX.md');
  const expectedAddress = `/${id}/IMUFusedData`;

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
    sock.close();

    const elapsedSec = Math.max(0, (clock() - startedAtMs) / 1000);
    let hz = 0;
    if (rows.length >= 2) {
      const durationSec = (rows[rows.length - 1]!.t - rows[0]!.t) / 1000;
      hz = durationSec > 0 ? Math.round((rows.length - 1) / durationSec) : rows.length;
    }

    const header = { label: opts.label, wrist: opts.wrist ?? null, id, startedAt: new Date(startedAtMs).toISOString(), hz };
    const lines = [JSON.stringify(header), ...rows.map((r) => JSON.stringify(r))];
    writeAtomic(takePath, lines.join('\n') + '\n');

    const date = header.startedAt.slice(0, 10);
    const whatNote = opts.what ?? '';
    const what = reason === 'stream-ended' ? `${whatNote}${whatNote ? ' ' : ''}(stream ended)` : whatNote;
    const who = opts.wrist ?? id;
    appendIndexRow(indexPath, `| ${opts.label} | ${who} | ${date} | ${elapsedSec.toFixed(1)} | ${what} |`);

    resolveDone({ path: takePath, rows: rows.length, reason, hz });
  }

  sock.on('message', (buf) => {
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
  });

  if (opts.seconds !== undefined) {
    secondsTimer = setTimeout(() => finish('seconds'), opts.seconds * 1000);
    secondsTimer.unref();
  }

  return { port: boundPort, stop: () => finish('stop'), done };
}
