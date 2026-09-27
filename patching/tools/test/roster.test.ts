// Roster tool tests: parse/render round-trip, add/remove idempotence and invariants (index 0
// and the trailing sentinel untouched), atomic writes, and the CLI's exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCommentHeader, missingPersonality, NAME_RE, parseRoster, renderRoster, rosterAdd, rosterList, rosterRemove } from '../src/roster.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'patch-roster.ts');

const ORIGINAL_TEXT = `// Conditions of Stillness roster. AirKit reads <root>/lists/<AIRKIT_LIST> from
// personalityController.scd; the Conditions profile sets AIRKIT_LIST=list_conditions.sc.
// Shape: ["silence", ...names..., "silence"]. Index 0 is what a new device gets; the LAST
// entry is unreachable (loadPersonality wraps with index.mod(size-1)) and is a sentinel.
(
\t[
\t\t"silence",
\t\t"COS_Template",
\t\t"silence",
\t]
)
`;

function tempRepo(rosterText: string = ORIGINAL_TEXT): string {
  const root = mkdtempSync(join(tmpdir(), 'cos-roster-'));
  writeFileSync(join(root, 'airkit.lock'), 'branch=AirConditions\nsha=abc\nupstream=u\nmirror=m\n');
  mkdirSync(join(root, 'airkit', 'lists'), { recursive: true });
  writeFileSync(join(root, 'airkit', 'lists', 'list_conditions.sc'), rosterText);
  mkdirSync(join(root, 'airkit', 'personalities'), { recursive: true });
  for (const n of ['COS_Template', 'COS_Foo']) writeFileSync(join(root, 'airkit', 'personalities', `${n}.sc`), '// patch\n');
  return root;
}

function withRepoRoot<T>(root: string, fn: () => T): T {
  const prev = process.env.COS_REPO_ROOT;
  process.env.COS_REPO_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.COS_REPO_ROOT; else process.env.COS_REPO_ROOT = prev;
  }
}

function runCli(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, COS_REPO_ROOT: root }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// --- parse / render --------------------------------------------------------------------------

test('parseRoster reads the names in order, including both bookends', () => {
  assert.deepEqual(parseRoster(ORIGINAL_TEXT), ['silence', 'COS_Template', 'silence']);
});

test('extractCommentHeader captures exactly the leading // lines', () => {
  const header = extractCommentHeader(ORIGINAL_TEXT);
  assert.equal(header, ORIGINAL_TEXT.split('(\n')[0]);
  assert.ok(header.split('\n').every((l) => l === '' || l.startsWith('//')));
});

test('renderRoster round-trips the original file byte-for-byte', () => {
  const header = extractCommentHeader(ORIGINAL_TEXT);
  const names = parseRoster(ORIGINAL_TEXT);
  assert.equal(renderRoster(names, header), ORIGINAL_TEXT);
});

test('renderRoster reproduces tabs and a trailing comma on every entry, including a longer list', () => {
  const header = extractCommentHeader(ORIGINAL_TEXT);
  const text = renderRoster(['silence', 'COS_Foo', 'COS_Bar', 'silence'], header);
  assert.equal(
    text,
    `${header}(\n\t[\n\t\t"silence",\n\t\t"COS_Foo",\n\t\t"COS_Bar",\n\t\t"silence",\n\t]\n)\n`,
  );
  assert.deepEqual(parseRoster(text), ['silence', 'COS_Foo', 'COS_Bar', 'silence']);
});

// --- rosterAdd / rosterRemove ------------------------------------------------------------------

test('rosterAdd inserts before the trailing sentinel and is idempotent', () => {
  const root = tempRepo();
  try {
    withRepoRoot(root, () => {
      assert.equal(rosterAdd('COS_Foo'), true);
      assert.deepEqual(rosterList(), ['silence', 'COS_Template', 'COS_Foo', 'silence']);
      assert.equal(rosterAdd('COS_Foo'), false); // idempotent: no duplicate, and reports it didn't write
      assert.deepEqual(rosterList(), ['silence', 'COS_Template', 'COS_Foo', 'silence']);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rosterRemove deletes the named entry and is idempotent, but never index 0 or the sentinel', () => {
  const root = tempRepo();
  try {
    withRepoRoot(root, () => {
      rosterAdd('COS_Foo');
      assert.equal(rosterRemove('COS_Template'), true);
      assert.deepEqual(rosterList(), ['silence', 'COS_Foo', 'silence']);
      assert.equal(rosterRemove('COS_Template'), false); // idempotent: already gone, no error, no write
      assert.deepEqual(rosterList(), ['silence', 'COS_Foo', 'silence']);
      assert.equal(rosterRemove('silence'), false); // bookends are never removed, even by value
      assert.deepEqual(rosterList(), ['silence', 'COS_Foo', 'silence']);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rosterAdd on a name already present is a true no-op: file left byte- and mtime-identical', () => {
  const root = tempRepo();
  const path = join(root, 'airkit', 'lists', 'list_conditions.sc');
  try {
    const before = statSync(path);
    const beforeText = readFileSync(path, 'utf8');
    const changed = withRepoRoot(root, () => rosterAdd('COS_Template'));
    const after = statSync(path);
    assert.equal(changed, false);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(readFileSync(path, 'utf8'), beforeText);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rosterRemove on an absent name is a true no-op: file left byte- and mtime-identical', () => {
  const root = tempRepo();
  const path = join(root, 'airkit', 'lists', 'list_conditions.sc');
  try {
    const before = statSync(path);
    const beforeText = readFileSync(path, 'utf8');
    const changed = withRepoRoot(root, () => rosterRemove('COS_NotThere'));
    const after = statSync(path);
    assert.equal(changed, false);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(readFileSync(path, 'utf8'), beforeText);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rosterRemove on a bookend-only value is a true no-op: file left byte- and mtime-identical', () => {
  const root = tempRepo();
  const path = join(root, 'airkit', 'lists', 'list_conditions.sc');
  try {
    const before = statSync(path);
    const changed = withRepoRoot(root, () => rosterRemove('silence'));
    const after = statSync(path);
    assert.equal(changed, false);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rosterRemove only removes a middle "silence" entry, not the bookends', () => {
  const header = extractCommentHeader(ORIGINAL_TEXT);
  const root = tempRepo(renderRoster(['silence', 'COS_Foo', 'silence', 'COS_Bar', 'silence'], header));
  try {
    withRepoRoot(root, () => {
      rosterRemove('silence');
      assert.deepEqual(rosterList(), ['silence', 'COS_Foo', 'COS_Bar', 'silence']);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rosterAdd/rosterRemove write atomically: no .tmp file left behind, header preserved', () => {
  const root = tempRepo();
  try {
    withRepoRoot(root, () => {
      rosterAdd('COS_Foo');
      rosterRemove('COS_Template');
    });
    const dir = join(root, 'airkit', 'lists');
    assert.deepEqual(readdirSync(dir), ['list_conditions.sc']);
    const text = readFileSync(join(dir, 'list_conditions.sc'), 'utf8');
    assert.equal(extractCommentHeader(text), extractCommentHeader(ORIGINAL_TEXT));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('NAME_RE matches COS_UpperCamel and rejects other shapes', () => {
  assert.ok(NAME_RE.test('COS_Foo'));
  assert.ok(NAME_RE.test('COS_Foo2H'));
  assert.ok(!NAME_RE.test('cos_foo'));
  assert.ok(!NAME_RE.test('COS_'));
  assert.ok(!NAME_RE.test('silence'));
});

// --- CLI -----------------------------------------------------------------------------------

test('CLI: list prints the roster, one name per line, exit 0', () => {
  const root = tempRepo();
  try {
    const r = runCli(root, ['list']);
    assert.equal(r.code, 0);
    assert.deepEqual(r.out.trim().split('\n'), ['silence', 'COS_Template', 'silence']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: add writes the roster and exits 0', () => {
  const root = tempRepo();
  try {
    const r = runCli(root, ['add', 'COS_Foo']);
    assert.equal(r.code, 0);
    assert.match(r.out, /added COS_Foo/);
    const text = readFileSync(join(root, 'airkit', 'lists', 'list_conditions.sc'), 'utf8');
    assert.deepEqual(parseRoster(text), ['silence', 'COS_Template', 'COS_Foo', 'silence']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: remove writes the roster and exits 0', () => {
  const root = tempRepo();
  try {
    const r = runCli(root, ['remove', 'COS_Template']);
    assert.equal(r.code, 0);
    assert.match(r.out, /removed COS_Template/);
    const text = readFileSync(join(root, 'airkit', 'lists', 'list_conditions.sc'), 'utf8');
    assert.deepEqual(parseRoster(text), ['silence', 'silence']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: add on an already-present name says so and does not rewrite the file, exit 0', () => {
  const root = tempRepo();
  const path = join(root, 'airkit', 'lists', 'list_conditions.sc');
  try {
    const before = statSync(path);
    const r = runCli(root, ['add', 'COS_Template']);
    assert.equal(r.code, 0);
    assert.match(r.out, /COS_Template already in roster/);
    const after = statSync(path);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: remove on an absent name says so and does not rewrite the file, exit 0', () => {
  const root = tempRepo();
  const path = join(root, 'airkit', 'lists', 'list_conditions.sc');
  try {
    const before = statSync(path);
    const r = runCli(root, ['remove', 'COS_NotThere']);
    assert.equal(r.code, 0);
    assert.match(r.out, /COS_NotThere not in roster/);
    const after = statSync(path);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: add refuses a name with no airkit/personalities/<Name>.sc (exit 1, path named, roster untouched)', () => {
  const root = tempRepo();
  const path = join(root, 'airkit', 'lists', 'list_conditions.sc');
  try {
    const before = readFileSync(path, 'utf8');
    const r = runCli(root, ['add', 'COS_Ghost']);
    assert.equal(r.code, 1);
    assert.ok(r.err.includes(join(root, 'airkit', 'personalities', 'COS_Ghost.sc')), r.err);
    assert.equal(readFileSync(path, 'utf8'), before);
    withRepoRoot(root, () => {
      assert.equal(missingPersonality('COS_Ghost'), join(root, 'airkit', 'personalities', 'COS_Ghost.sc'));
      assert.equal(missingPersonality('COS_Foo'), null);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: exits 1 when the name does not match COS_UpperCamel', () => {
  const root = tempRepo();
  try {
    const add = runCli(root, ['add', 'not-a-name']);
    assert.equal(add.code, 1);
    assert.match(add.err, /must match/);
    const remove = runCli(root, ['remove', 'silence']);
    assert.equal(remove.code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: exits 2 on usage errors', () => {
  const root = tempRepo();
  try {
    assert.equal(runCli(root, []).code, 2);
    assert.equal(runCli(root, ['bogus', 'COS_Foo']).code, 2);
    assert.equal(runCli(root, ['add']).code, 2);
    assert.equal(runCli(root, ['add', 'COS_Foo', 'extra']).code, 2);
    assert.equal(runCli(root, ['list', 'COS_Foo']).code, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
