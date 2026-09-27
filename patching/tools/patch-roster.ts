// CLI to add/remove/list personalities in the Conditions of Stillness roster
// (airkit/lists/list_conditions.sc), atomically, keeping the "silence" bookends (ruling 8).
//
// Usage: node patching/tools/patch-roster.ts add <Name>
//        node patching/tools/patch-roster.ts remove <Name>
//        node patching/tools/patch-roster.ts list
// Exit 0 success, 1 <Name> doesn't match ^COS_[A-Z][A-Za-z0-9]*$ or (add) there is no
// airkit/personalities/<Name>.sc, 2 usage.
import { missingPersonality, NAME_RE, rosterAdd, rosterList, rosterRemove } from './src/roster.ts';

const USAGE = 'usage: patch-roster.ts add <Name> | remove <Name> | list';
const args = process.argv.slice(2);

function fail(msg: string, code: number): never {
  console.error(`patch-roster: ${msg}`);
  process.exit(code);
}

const [cmd, ...rest] = args;

if (cmd === 'list') {
  if (rest.length !== 0) fail(USAGE, 2);
  for (const name of rosterList()) console.log(name);
  process.exit(0);
}

if (cmd !== 'add' && cmd !== 'remove') fail(USAGE, 2);
if (rest.length !== 1) fail(USAGE, 2);
const name = rest[0]!;
if (!NAME_RE.test(name)) fail(`name must match ${NAME_RE}: ${name}`, 1);

if (cmd === 'add') {
  const missing = missingPersonality(name);
  if (missing) fail(`no personality file ${missing} — write (and mv) the patch before adding it to the roster`, 1);
  const changed = rosterAdd(name);
  console.log(changed ? `added ${name}` : `${name} already in roster`);
} else {
  const changed = rosterRemove(name);
  console.log(changed ? `removed ${name}` : `${name} not in roster`);
}
process.exit(0);
