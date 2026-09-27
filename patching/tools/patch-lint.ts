// Static lint for a Conditions of Stillness personality (rules in src/lint.ts).
//
// Usage: node patching/tools/patch-lint.ts <Name | path/to/Name.sc> [--json] [--profile <path>]
// A bare name resolves to airkit/personalities/<Name>.sc. Exit 0 = no errors (warnings allowed),
// 1 = errors, 2 = usage, missing file, unreadable profile or a linter exception. Under --json a
// failure prints {"error": "..."} on stdout, so a JSON consumer never sees an empty stdout.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatIssue, lint, loadProfile, type Issue, type Profile } from './src/lint.ts';
import { personalityPath } from './src/sc.ts';

const USAGE = 'usage: patch-lint.ts <Name | path.sc> [--json] [--profile <path>]';
const args = process.argv.slice(2);
const json = args.includes('--json');

function fail(msg: string, showUsage = false): never {
  if (json) console.log(JSON.stringify({ error: msg }));
  console.error(`patch-lint: ${msg}`);
  if (showUsage) console.error(USAGE);
  process.exit(2);
}

let profilePath: string | undefined;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--json') continue;
  else if (a === '--profile') { profilePath = args[++i]; if (!profilePath) fail('--profile needs a path', true); }
  else if (a.startsWith('--')) fail(`unknown option ${a}`, true);
  else positional.push(a);
}
if (positional.length !== 1) fail('expected exactly one <Name | path.sc>', true);

const target = positional[0]!;
const path = target.endsWith('.sc') || target.includes('/') ? resolve(target) : personalityPath(target);
if (!existsSync(path) || !statSync(path).isFile()) fail(`no such file ${path}`);

let profile: Profile;
try { profile = loadProfile(profilePath ? resolve(profilePath) : undefined); }
catch (e) { fail(`profile: ${(e as Error).message}`); }

let issues: Issue[];
try { issues = lint(path, { profile }); }
catch (e) { fail(`lint failed: ${(e as Error).message}`); }

const errors = issues.filter((i) => i.severity === 'E').length;
if (json) console.log(JSON.stringify(issues, null, 2));
else {
  for (const i of issues) console.log(formatIssue(i));
  console.log(`${target}: ${errors} error(s), ${issues.length - errors} warning(s)`);
}
process.exit(errors ? 1 : 0);
