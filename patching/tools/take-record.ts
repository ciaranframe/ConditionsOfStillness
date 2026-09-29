// CLI for the take recorder (src/take.ts). Records one stick's raw IMU stream to
// takes/<label>.take.jsonl and appends a row to takes/INDEX.md.
//
// Usage: node patching/tools/take-record.ts <label> (--wrist ZL|ZR|CL|CR | --id N [--as CF])
//          [--seconds 30] [--port 8001] [--what "piano scales slow"] [--out DIR] [--force]
// --as files an --id take under a label that is not a performer wrist (INDEX "wrist" column).
// With no --seconds, records until Ctrl-C (SIGINT ends the take cleanly). The stick must stream
// to --port (default 8001): repoint one stick there with /Config/RequestStream, or stop the
// runner and record on 8000. A warning is printed if nothing arrives within 3 s.
// Exit 0 take written; 1 no packets recorded (nothing written), the label already exists
// (--force replaces it), or the recorder could not start (bind, cast.yaml); 2 usage.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LABEL_RE, recordTake, takePath } from './src/take.ts';
import type { Wrist } from '../../runner/src/scenes.ts';

const USAGE =
  'usage: take-record.ts <label> (--wrist ZL|ZR|CL|CR | --id N [--as CF]) [--seconds S] [--port P] [--what "..."] [--out DIR] [--force]';
const WRISTS = ['ZL', 'ZR', 'CL', 'CR'];

function fail(msg: string): never {
  console.error(`take-record: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}

const argv = process.argv.slice(2);
let wrist: string | undefined;
let id: string | undefined;
let as: string | undefined;
let seconds: number | undefined;
let port: number | undefined;
let what: string | undefined;
let out: string | undefined;
let force = false;
const positional: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  switch (a) {
    case '--wrist': wrist = argv[++i]; break;
    case '--id': id = argv[++i]; break;
    case '--as': as = argv[++i]; break;
    case '--seconds': seconds = Number(argv[++i]); break;
    case '--port': port = Number(argv[++i]); break;
    case '--what': what = argv[++i]; break;
    case '--out': out = argv[++i]; break;
    case '--force': force = true; break;
    default:
      if (a.startsWith('--')) fail(`unknown option ${a}`);
      positional.push(a);
  }
}

if (positional.length !== 1) fail('expected exactly one <label>');
const label = positional[0]!;
if (!LABEL_RE.test(label)) fail(`<label> must be letters, digits, _ . - only (got ${JSON.stringify(label)})`);
if (!wrist && !id) fail('need --wrist <ZL|ZR|CL|CR> or --id <N>');
if (wrist && id) fail('give --wrist or --id, not both');
if (as !== undefined && !id) fail('--as goes with --id (a --wrist take is filed under its wrist)');
if (as !== undefined && !LABEL_RE.test(as)) fail(`--as must be letters, digits, _ . - only (got ${JSON.stringify(as)})`);
if (wrist && !WRISTS.includes(wrist)) fail(`--wrist must be one of ${WRISTS.join(', ')}`);
if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0)) fail('--seconds must be a positive number');
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) fail('--port must be a port number');
if (out !== undefined) out = resolve(out);

const existing = takePath(label, out);
if (existsSync(existing) && !force) {
  console.error(`take-record: a take labelled ${label} already exists (${existing}); pick another label or pass --force to replace it`);
  process.exit(1);
}

let handle;
try {
  handle = await recordTake({ label, wrist: wrist as Wrist | undefined, id, as, seconds, port, what, out, force });
} catch (e) {
  console.error(`take-record: ${(e as Error).message}`);
  process.exit(1);
}

console.error(`take-record: recording on port ${handle.port}${seconds ? ` for ${seconds}s` : ' — Ctrl-C to stop'}...`);
process.on('SIGINT', () => handle.stop());

const result = await handle.done;
if (!result.written) {
  console.error(`take-record: no packets from the stick — nothing written (no ${result.path}, no INDEX.md row)`);
  process.exit(1);
}
console.log(`${result.rows} rows -> ${result.path}`);
process.exit(0);
