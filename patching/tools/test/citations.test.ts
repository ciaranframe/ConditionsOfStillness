// Citation check for the airkit-patch skill references. Convention (engine.md, "Citation
// convention"): `token` (path:line) — the backticked token is a literal substring of that line.
// Every citation whose path starts with airkit/ or patching/corpus/ is resolved against the MAIN
// checkout (COS_MAIN_ROOT, default below), because airkit/ is a gitignored worktree and the raw
// corpus is gitignored: neither exists inside a task worktree. Skips when the root is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN_ROOT = process.env.COS_MAIN_ROOT ?? '/Users/ciaran/Documents/ConditionsOfStillness';
const HERE = dirname(fileURLToPath(import.meta.url));
const REFS = resolve(HERE, '../../../.claude/skills/airkit-patch/references');

// `token` then optional whitespace then (airkit/...:N) or (patching/corpus/...:N)
const CITED = /`([^`\n]+)`\s*\(((?:airkit|patching\/corpus)\/[^():\n]+):(\d+)\)/g;
// any citation of those trees, conventional or not
const ANY = /\(((?:airkit|patching\/corpus)\/[^():\n]+):(\d+)\)/g;

type Citation = { doc: string; token: string; path: string; line: number };

export function parseCitations(doc: string, text: string): { cited: Citation[]; bare: string[] } {
  const cited: Citation[] = [];
  const at = new Set<number>();
  for (const m of text.matchAll(CITED)) {
    cited.push({ doc, token: m[1]!, path: m[2]!, line: Number(m[3]) });
    at.add(m.index! + m[0].lastIndexOf('('));
  }
  const bare = [...text.matchAll(ANY)].filter((m) => !at.has(m.index!)).map((m) => m[0]);
  return { cited, bare };
}

test('parseCitations: token convention and bare citations', () => {
  const r = parseCitations('x.md', 'a `foo = 1` (airkit/a.scd:3) and a bare (airkit/b.scd:4); `z` (docs/c.md:1)');
  assert.deepEqual(r.cited, [{ doc: 'x.md', token: 'foo = 1', path: 'airkit/a.scd', line: 3 }]);
  assert.deepEqual(r.bare, ['(airkit/b.scd:4)']);
});

const docs = existsSync(REFS) ? readdirSync(REFS).filter((f) => f.endsWith('.md')) : [];

test('references exist and engine.md carries citations', () => {
  assert.ok(docs.includes('engine.md'), `no engine.md under ${REFS}`);
  const { cited } = parseCitations('engine.md', readFileSync(join(REFS, 'engine.md'), 'utf8'));
  assert.ok(cited.length >= 40, `engine.md has only ${cited.length} checked citations`);
});

for (const doc of docs) {
  test(`citations resolve: ${doc}`, (t) => {
    const { cited, bare } = parseCitations(doc, readFileSync(join(REFS, doc), 'utf8'));
    assert.deepEqual(bare, [], `${doc}: citations without a preceding \`token\`: ${bare.join(', ')}`);
    if (!existsSync(MAIN_ROOT)) { t.skip(`main checkout not found at ${MAIN_ROOT} (set COS_MAIN_ROOT)`); return; }
    const failures: string[] = [];
    let checked = 0;
    for (const c of cited) {
      const file = join(MAIN_ROOT, c.path);
      const tree = c.path.startsWith('airkit/') ? join(MAIN_ROOT, 'airkit') : join(MAIN_ROOT, 'patching', 'corpus', c.path.split('/')[2]!);
      if (!existsSync(tree)) continue; // that tree isn't materialised in this checkout
      if (!existsSync(file)) { failures.push(`${c.path}:${c.line} — file not found`); continue; }
      const lines = readFileSync(file, 'utf8').split('\n');
      const line = lines[c.line - 1];
      checked++;
      if (line === undefined) failures.push(`${c.path}:${c.line} — past end of file (${lines.length} lines)`);
      else if (!line.includes(c.token)) failures.push(`${c.path}:${c.line} — "${c.token}" not on that line: ${line.trim()}`);
    }
    if (checked === 0 && cited.length > 0) { t.skip('no cited tree is present under the main root'); return; }
    assert.deepEqual(failures, [], `${doc}: ${failures.length} citation(s) do not resolve`);
  });
}
