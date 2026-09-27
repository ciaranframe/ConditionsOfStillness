// CLI to add/remove/list personalities in the Conditions of Stillness roster
// (airkit/lists/list_conditions.sc), atomically, keeping the "silence" bookends (ruling 8).
//
// Usage: node patching/tools/patch-roster.ts add <Name>
//        node patching/tools/patch-roster.ts remove <Name>
//        node patching/tools/patch-roster.ts list
// Exit 0 success, 1 <Name> doesn't match ^COS_[A-Z][A-Za-z0-9]*$, 2 usage.
import { NAME_RE, rosterAdd, rosterList, rosterRemove } from './src/roster.ts';

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

if (cmd === 'add') rosterAdd(name); else rosterRemove(name);
console.log(`${cmd === 'add' ? 'added' : 'removed'} ${name}`);
process.exit(0);
