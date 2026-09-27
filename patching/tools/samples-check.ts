// CLI for the samples workflow (src/samples.ts): matches downloaded files in
// samples/COS_<Name>/ to the slots declared in its SHOPPING.md, converts them to 48 kHz WAV via
// ffmpeg, and writes manifest.json and a SOURCES.md skeleton (Task 7, spec §8).
//
// Usage: node patching/tools/samples-check.ts COS_<Name> [--dir samples/]
// Exit 0 every slot converted (warnings allowed), 1 any slot missing/unreadable/failed-to-
// convert or an audio file matches no slot (Review Focus 5), 2 usage, no SHOPPING.md, or a
// malformed SHOPPING.md/SOURCES.md (a usage-class error — checkSamples throws for those), or
// ffmpeg/ffprobe not installed ("install ffmpeg (brew install ffmpeg)").
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkSamples, MissingToolError } from './src/samples.ts';
import { repoRoot } from './src/sc.ts';

const USAGE = 'usage: samples-check.ts COS_<Name> [--dir samples/]';

function fail(msg: string): never {
  console.error(`samples-check: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}

const argv = process.argv.slice(2);
let dirOpt: string | undefined;
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === '--dir') {
    dirOpt = argv[++i];
    if (dirOpt === undefined) fail('--dir needs a path');
  } else if (a.startsWith('--')) {
    fail(`unknown option ${a}`);
  } else {
    positional.push(a);
  }
}
if (positional.length !== 1) fail('expected exactly one COS_<Name>');
const name = positional[0]!;

const root = dirOpt !== undefined ? resolve(dirOpt) : join(repoRoot(), 'samples');
const dir = join(root, name);
const shoppingPath = join(dir, 'SHOPPING.md');
if (!existsSync(shoppingPath)) fail(`no SHOPPING.md at ${shoppingPath}`);

let result;
try {
  result = checkSamples(dir);
} catch (e) {
  if (e instanceof MissingToolError) {
    console.error(`samples-check: ${e.tool} not found — install ffmpeg (brew install ffmpeg)`);
    process.exit(2);
  }
  fail((e as Error).message);
}
for (const line of result.lines) console.log(line);
process.exit(result.exitCode);
