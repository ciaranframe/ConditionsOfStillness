// CLI for the take recorder (src/take.ts). Records one stick's raw IMU stream to
// takes/<label>.take.jsonl and appends a row to takes/INDEX.md.
//
// Usage: node patching/tools/take-record.ts <label> (--wrist ZL|ZR|CL|CR | --id N)
//          [--seconds 30] [--port 8001] [--what "piano scales slow"] [--out DIR]
// With no --seconds, records until Ctrl-C (SIGINT ends the take cleanly). Exit 2 on usage.
import { recordTake } from './src/take.ts';
import type { Wrist } from '../../runner/src/scenes.ts';

const USAGE =
  'usage: take-record.ts <label> (--wrist ZL|ZR|CL|CR | --id N) [--seconds S] [--port P] [--what "..."] [--out DIR]';
const WRISTS = ['ZL', 'ZR', 'CL', 'CR'];

function fail(msg: string): never {
  console.error(`take-record: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}

const argv = process.argv.slice(2);
let wrist: string | undefined;
let id: string | undefined;
let seconds: number | undefined;
let port: number | undefined;
let what: string | undefined;
let out: string | undefined;
const positional: string[] = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  switch (a) {
    case '--wrist': wrist = argv[++i]; break;
    case '--id': id = argv[++i]; break;
    case '--seconds': seconds = Number(argv[++i]); break;
    case '--port': port = Number(argv[++i]); break;
    case '--what': what = argv[++i]; break;
    case '--out': out = argv[++i]; break;
    default:
      if (a.startsWith('--')) fail(`unknown option ${a}`);
      positional.push(a);
  }
}

if (positional.length !== 1) fail('expected exactly one <label>');
const label = positional[0]!;
if (!wrist && !id) fail('need --wrist <ZL|ZR|CL|CR> or --id <N>');
if (wrist && id) fail('give --wrist or --id, not both');
if (wrist && !WRISTS.includes(wrist)) fail(`--wrist must be one of ${WRISTS.join(', ')}`);
if (seconds !== undefined && (!Number.isFinite(seconds) || seconds <= 0)) fail('--seconds must be a positive number');
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) fail('--port must be a port number');

const handle = await recordTake({
  label,
  wrist: wrist as Wrist | undefined,
  id,
  seconds,
  port,
  what,
  out,
});

console.error(`take-record: recording on port ${handle.port}${seconds ? ` for ${seconds}s` : ' — Ctrl-C to stop'}...`);
process.on('SIGINT', () => handle.stop());

const result = await handle.done;
console.log(`${result.rows} rows -> ${result.path}`);
process.exit(0);
