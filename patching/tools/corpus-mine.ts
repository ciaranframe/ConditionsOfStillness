// corpus-mine.ts [--repo airkit] [--branches a,b,…] [--out patching/corpus] [--ref-prefix origin/]
// Mines personalities/ and synths/ .sc files from git objects (nothing checked out) into the
// corpus dir: raw copies (gitignored) plus index.json, INDEX.md, stats.md. Exit 1 on a git error.
import { join, resolve } from 'node:path';
import { DEFAULT_BRANCHES, mine } from './src/mine.ts';
import { airkitRoot, repoRoot } from './src/sc.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : undefined;
}

try {
  const repo = resolve(arg('repo') ?? airkitRoot());
  const branches = arg('branches')?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_BRANCHES;
  const out = resolve(arg('out') ?? join(repoRoot(), 'patching', 'corpus'));
  const refPrefix = arg('ref-prefix') ?? 'origin/';
  const index = mine({ repo, branches, out, refPrefix });
  for (const b of index.branches) {
    console.log(`${b.name.padEnd(20)} ${String(b.personalities).padStart(4)} personalities ${String(b.synths).padStart(4)} synths`);
  }
  const blobs = new Set(index.entries.map((e) => e.blob)).size;
  const dups = index.entries.filter((e) => e.duplicateOf).length;
  console.log(`${index.entries.length} entries, ${blobs} unique blobs, ${dups} duplicates -> ${out}`);
} catch (e) {
  const err = e as { stderr?: Buffer | string; message: string };
  console.error(`corpus-mine: ${String(err.stderr ?? '').trim() || err.message}`);
  process.exit(1);
}
