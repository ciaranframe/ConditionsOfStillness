// Static lint for a Conditions of Stillness personality (rules in src/lint.ts).
//
// Usage: node patching/tools/patch-lint.ts <Name | path/to/Name.sc> [--json] [--profile <path>]
// A bare name resolves to airkit/personalities/<Name>.sc. Exit 0 = no errors (warnings allowed),
// 1 = errors, 2 = usage, missing file or unreadable profile.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatIssue, lint, loadProfile, type Profile } from './src/lint.ts';
import { personalityPath } from './src/sc.ts';

const USAGE = 'usage: patch-lint.ts <Name | path.sc> [--json] [--profile <path>]';

function usage(msg?: string): never {
  if (msg) console.error(`patch-lint: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}

const args = process.argv.slice(2);
let json = false;
let profilePath: string | undefined;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--json') json = true;
  else if (a === '--profile') { profilePath = args[++i]; if (!profilePath) usage('--profile needs a path'); }
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else positional.push(a);
}
if (positional.length !== 1) usage();

const target = positional[0]!;
const path = target.endsWith('.sc') || target.includes('/') ? resolve(target) : personalityPath(target);
if (!existsSync(path) || !statSync(path).isFile()) { console.error(`patch-lint: no such file ${path}`); process.exit(2); }

let profile: Profile;
try { profile = loadProfile(profilePath ? resolve(profilePath) : undefined); }
catch (e) { console.error(`patch-lint: profile: ${(e as Error).message}`); process.exit(2); }

const issues = lint(path, { profile });
const errors = issues.filter((i) => i.severity === 'E').length;
if (json) console.log(JSON.stringify(issues, null, 2));
else {
  for (const i of issues) console.log(formatIssue(i));
  console.log(`${target}: ${errors} error(s), ${issues.length - errors} warning(s)`);
}
process.exit(errors ? 1 : 0);
