// Parse-check a personality in a throwaway headless sclang (~3 s), so a syntax error never
// reaches the live AirKit, which would hot-load it. Does not execute the patch. A thin CLI over
// compileCheck (src/sc.ts), which owns the throwaway .scd and always removes it.
//
// The idiom (and the grepped error context printed on a failure) is Glimmer's
// tools/patch-compile.sh (airkit-glimmer/tools/patch-compile.sh), credit there.
//
// Usage: node patching/tools/patch-compile.ts <Name | path>
// A bare name resolves to airkit/personalities/<Name>.sc (COS_REPO_ROOT honoured); a path —
// including the skill's `.sc.tmp` edit copy, checked BEFORE the mv — is used as given.
// Exit 0 parses, 1 does not parse (error context printed), 2 usage, missing file or missing sclang.
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { compileCheck, personalityPath, SCLANG } from './src/sc.ts';

const USAGE = 'usage: patch-compile.ts <Name | path.sc | path.sc.tmp>';

function fail(msg: string, showUsage = false): never {
  console.error(`patch-compile: ${msg}`);
  if (showUsage) console.error(USAGE);
  process.exit(2);
}

/** Non-blank lines around every ERROR/syntax/unexpected/PARSE FAILED line (2 before, 8 after),
 * first 40 — what `grep -i -B2 -A8 … | head -40` printed in the shell version. */
function errorContext(output: string): string[] {
  const lines = output.split('\n').filter((l) => l.trim() !== '');
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (/ERROR|syntax|unexpected|PARSE FAILED/i.test(l)) for (let k = Math.max(0, i - 2); k <= Math.min(lines.length - 1, i + 8); k++) keep.add(k);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]!).slice(0, 40);
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0]!.startsWith('--')) fail('expected exactly one <Name | path>', true);
const target = args[0]!;
const path = /\.sc(\.tmp)?$/.test(target) || target.includes('/') ? resolve(target) : personalityPath(target);
if (!existsSync(path) || !statSync(path).isFile()) fail(`no such file ${path}`);
if (!existsSync(SCLANG)) fail(`sclang not found at ${SCLANG} (install SuperCollider)`);

const r = compileCheck(path);
if (r.ok) {
  console.log(`${basename(path)}: parses`);
  process.exit(0);
}
const context = errorContext(r.output);
console.log(context.length ? context.join('\n') : r.output || '(no output from sclang)');
console.log(`${basename(path)}: does not parse`);
process.exit(1);
