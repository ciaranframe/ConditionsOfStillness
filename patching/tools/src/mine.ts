// Corpus mining (plan ruling 2): every personalities/ and synths/ .sc file on the listed AirKit
// branches, read from git objects only. Files are deduplicated by blob (one raw copy, written at
// the first branch/path in branch order); the index lists every branch/path an entry appears at.
// An entry is one (name, blob) pair, so "Foo copy.sc" with Foo.sc's exact bytes is still its own
// entry, flagged duplicateOf "Foo". Raw copies are gitignored; index.json, INDEX.md and stats.md
// are committed and written atomically.
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { writeAtomic } from './atomic.ts';
import { listTree, readBlob, resolveCommit } from './git.ts';

export type Idiom = 'pdef' | 'ndef' | 'synth' | 'hybrid' | 'none';

export type FileFacts = {
  headerKeys: string[];
  ugens: string[];
  idiom: Idiom;
  modelFields: string[];
  hooks: string[];
  thresholds: number[];
  samples: boolean;
  lines: number;
};

export type Location = { branch: string; path: string };

export type Entry = {
  name: string;
  kind: 'personality' | 'synth';
  blob: string;
  size: number;
  lines: number;
  raw: string; // raw copy relative to the corpus dir: <firstBranch>/<path>
  branches: Location[];
  duplicateOf?: string;
  duplicateOfBlob?: string;
  facts: FileFacts;
};

export type BranchInfo = { name: string; ref: string; commit: string; files: number; personalities: number; synths: number };

// No timestamp: the outputs are a pure function of the mined commits, so a re-run is a no-op.
export type Index = { branches: BranchInfo[]; entries: Entry[] };

export const DEFAULT_BRANCHES = ['Airsticks-RPI', 'Airsticks-Desktop', 'MiMBrentonShows', 'master', 'AirConcert'];
export const PREFIXES = ['personalities', 'synths'];

const KNOWN_HOOKS = new Set([
  'init', 'deinit', 'next', 'nextMidiOut', 'idleNext', 'tuningNext', 'pieceNext', 'curtainNext',
  'onRoomState', 'onResync', 'onSceneParams', 'onEvent', 'onHit', 'onMoving', 'onSection', 'onScale',
  'onKey', 'onChord', 'onBeat', 'onPhrase', 'onBar', 'onTick', 'onHalf', 'midiControllerValue',
]);

// Blank out comments (SC block comments nest) while keeping strings, symbols and newlines, so
// commented-out code does not count as UGens, idioms or hooks.
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '$' && i + 1 < n) { out += c + d; i += 2; continue; } // char literal, e.g. $" or $/
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      let depth = 0;
      while (i < n) {
        if (src[i] === '/' && src[i + 1] === '*') { depth++; out += '  '; i += 2; continue; }
        if (src[i] === '*' && src[i + 1] === '/') { depth--; out += '  '; i += 2; if (depth === 0) break; continue; }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function headerKeys(src: string): string[] {
  const s = src.replace(/^﻿/, '').trimStart();
  if (!s.startsWith('/*')) return [];
  const end = s.indexOf('*/');
  if (end < 0) return [];
  const keys: string[] = [];
  for (const line of s.slice(2, end).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][\w-]*)\s*:(\s|$)/.exec(line);
    if (m) keys.push(m[1]);
  }
  return uniq(keys);
}

const MODEL = String.raw`(?:(?<![\w.~\\])m|~model)`;
const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

export function analyse(source: string): FileFacts {
  const code = stripComments(source);
  const ugens = uniq([...code.matchAll(/\b([A-Z][A-Za-z0-9_]*)\.(?:ar|kr|ir)\b/g)].map((m) => m[1]));
  const has = {
    pdef: /\bPdef\b/.test(code),
    ndef: /\bNdef\b/.test(code),
    synth: /\bSynth\s*\(|\bSynth\.(?:new|after|before|head|tail|grain|replace)\b/.test(code),
  };
  const present = (Object.keys(has) as Array<keyof typeof has>).filter((k) => has[k]);
  const idiom: Idiom = present.length > 1 ? 'hybrid' : present.length === 1 ? present[0] : 'none';
  const modelFields = uniq(
    [...code.matchAll(new RegExp(String.raw`${MODEL}\.([A-Za-z_]\w*)\b(?!\s*=(?!=))`, 'g'))].map((m) => m[1]),
  );
  const hooks = uniq(
    [...code.matchAll(/~([A-Za-z_]\w*)\s*=(?!=)/g)]
      .map((m) => m[1])
      .filter((h) => KNOWN_HOOKS.has(h))
      .map((h) => `~${h}`),
  );
  const field = String.raw`${MODEL}\.[A-Za-z_]\w*(?:\.\w+)*`;
  const cmp = String.raw`(?:[<>]=?|==)`;
  const thresholds = uniq([
    ...[...code.matchAll(new RegExp(String.raw`${field}\s*${cmp}\s*${NUM}`, 'g'))].map((m) => Number(m[1])),
    ...[...code.matchAll(new RegExp(String.raw`${NUM}\s*${cmp}\s*${field}`, 'g'))].map((m) => Number(m[1])),
  ]);
  const samples = /\bBuffer\.(?:read|readChannel|alloc)\b/.test(code);
  const parts = source.split('\n');
  const lines = source === '' ? 0 : source.endsWith('\n') ? parts.length - 1 : parts.length;
  return { headerKeys: headerKeys(source), ugens, idiom, modelFields, hooks, thresholds, samples, lines };
}

// "Foo copy" / "Foo copy 2" / "Foo 2" / "Foo (2)" -> "Foo".
export function stripCopyName(name: string): string {
  let prev = '';
  let s = name;
  while (s !== prev) {
    prev = s;
    s = s.replace(/\s+copy(?:\s+\d+)?$/i, '').replace(/\s+\d+$/, '').replace(/\s*\(\d+\)$/, '');
  }
  return s || name;
}

export function mine(opts: { repo: string; branches: string[]; out: string; refPrefix?: string }): Index {
  const prefix = opts.refPrefix ?? '';
  const branches: BranchInfo[] = [];
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  const rawByBlob = new Map<string, { raw: string; facts: FileFacts }>();

  for (const branch of opts.branches) {
    const ref = prefix + branch;
    const commit = resolveCommit(opts.repo, ref);
    const files = listTree(opts.repo, commit, PREFIXES);
    branches.push({
      name: branch,
      ref,
      commit,
      files: files.length,
      personalities: files.filter((f) => f.path.startsWith('personalities/')).length,
      synths: files.filter((f) => f.path.startsWith('synths/')).length,
    });
    for (const f of files) {
      const name = basename(f.path, '.sc');
      const kind = f.path.startsWith('synths/') ? 'synth' : 'personality';
      const key = `${kind}\0${name}\0${f.blob}`;
      let seen = rawByBlob.get(f.blob);
      if (!seen) {
        const text = readBlob(opts.repo, f.blob);
        const raw = `${branch}/${f.path}`;
        const dest = join(opts.out, branch, f.path);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, text); // raw copies are gitignored; not hot-loaded, so a direct write is fine
        seen = { raw, facts: analyse(text) };
        rawByBlob.set(f.blob, seen);
      }
      const loc = { branch, path: f.path };
      const existing = byKey.get(key);
      if (existing) {
        existing.branches.push(loc);
        continue;
      }
      const e: Entry = {
        name, kind, blob: f.blob, size: f.size, lines: seen.facts.lines, raw: seen.raw,
        branches: [loc], facts: seen.facts,
      };
      byKey.set(key, e);
      entries.push(e);
    }
  }

  markDuplicates(entries);
  const index: Index = { branches, entries };
  writeAtomic(join(opts.out, 'index.json'), indexJson(index));
  writeAtomic(join(opts.out, 'INDEX.md'), indexMd(index));
  writeAtomic(join(opts.out, 'stats.md'), statsMd(index));
  return index;
}

const ORDINAL = /^\d+\.\s/;

function branchCount(e: Entry): number {
  return new Set(e.branches.map((l) => l.branch)).size;
}

// Among byte-identical entries the original is: `silence` if present, else a name without a
// leading "N. " ordinal, else the name on the most branches, else the shortest name, else the
// first in branch order (entries are already in branch order, and sort is stable).
function pickCanonical(group: Entry[]): Entry {
  const rank = (e: Entry): number[] => [
    e.name === 'silence' ? 0 : 1,
    ORDINAL.test(e.name) ? 1 : 0,
    -branchCount(e),
    e.name.length,
  ];
  return [...group].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  })[0];
}

function markDuplicates(entries: Entry[]): void {
  const byBlob = new Map<string, Entry[]>();
  for (const e of entries) byBlob.set(e.blob, [...(byBlob.get(e.blob) ?? []), e]);
  for (const group of byBlob.values()) {
    if (group.length < 2) continue;
    const canon = pickCanonical(group);
    for (const e of group) {
      if (e === canon) continue;
      e.duplicateOf = canon.name;
      e.duplicateOfBlob = canon.blob;
    }
  }
  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = `${e.kind}\0${e.name}`;
    byName.set(k, [...(byName.get(k) ?? []), e]);
  }
  for (const e of entries) {
    if (e.duplicateOf) continue;
    const base = stripCopyName(e.name);
    if (base === e.name) continue;
    const targets = byName.get(`${e.kind}\0${base}`);
    if (!targets) continue;
    // Several versions may share the base name: prefer one on a branch this entry is on.
    const mine = new Set(e.branches.map((l) => l.branch));
    const target = targets.find((t) => t.branches.some((l) => mine.has(l.branch))) ?? targets[0];
    e.duplicateOf = target.name;
    e.duplicateOfBlob = target.blob;
  }
}

// One entry per line keeps index.json diffable.
function indexJson(index: Index): string {
  const lines = [
    '{',
    '  "branches": [',
    index.branches.map((b) => `    ${JSON.stringify(b)}`).join(',\n'),
    '  ],',
    '  "entries": [',
    index.entries.map((e) => `    ${JSON.stringify(e)}`).join(',\n'),
    '  ]',
    '}',
    '',
  ];
  return lines.join('\n');
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function indexMd(index: Index): string {
  const out: string[] = [
    '# AirKit corpus index',
    '',
    `Generated by \`patching/tools/corpus-mine.ts\` from ${index.branches.map((b) => `${b.name} @ ${b.commit.slice(0, 7)}`).join(', ')}.`,
    'Raw files (gitignored) are under',
    '`patching/corpus/<branch>/<path>`, one copy per blob at the first branch it appears on (see the',
    '`raw` field in `index.json`). "dup of" marks a byte-identical file under another name or a',
    '`copy`/` N`/`(N)` variant of another name.',
    '',
  ];
  for (const b of index.branches) {
    out.push(`## ${b.name} @ ${b.commit.slice(0, 7)}`, '', `\`${b.ref}\` (${b.commit}): ${b.personalities} personalities, ${b.synths} synths.`, '');
    for (const kind of ['personality', 'synth'] as const) {
      const rows = index.entries
        .filter((e) => e.kind === kind)
        .flatMap((e) => e.branches.filter((l) => l.branch === b.name).map((l) => ({ e, l })));
      if (rows.length === 0) continue;
      out.push(`### ${kind === 'personality' ? 'Personalities' : 'Synths'}`, '');
      out.push('| name | idiom | UGens | samples | size | also on |', '|---|---|---:|---|---:|---|');
      rows.sort((x, y) => x.l.path.localeCompare(y.l.path));
      for (const { e, l } of rows) {
        const also = uniq(e.branches.map((x) => x.branch).filter((x) => x !== b.name)).join(', ');
        const shown = basename(l.path, '.sc');
        const dup = e.duplicateOf ? ` (dup of ${e.duplicateOf})` : '';
        out.push(
          `| ${cell(shown)}${cell(dup)} | ${e.facts.idiom} | ${e.facts.ugens.length} | ${e.facts.samples ? 'yes' : ''} | ${kb(e.size)} | ${cell(also)} |`,
        );
      }
      out.push('');
    }
  }
  return out.join('\n');
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function statsMd(index: Index): string {
  const originals = index.entries.filter((e) => !e.duplicateOf);
  const pers = originals.filter((e) => e.kind === 'personality');
  const blobs = new Set(index.entries.map((e) => e.blob)).size;
  const dups = index.entries.length - originals.length;
  const out: string[] = [
    '# AirKit corpus statistics',
    '',
    `Mined from ${index.branches.map((b) => `${b.name} @ ${b.commit.slice(0, 7)}`).join(', ')}.`,
    '',
    `${index.entries.length} entries (${blobs} unique blobs, ${dups} flagged duplicates);`,
    `statistics below are over the ${originals.length} non-duplicate entries (${pers.length} personalities).`,
    '',
    '## Per-branch totals',
    '',
    '| branch | ref | commit | personalities | synths | only on this branch |',
    '|---|---|---|---:|---:|---:|',
  ];
  for (const b of index.branches) {
    const only = index.entries.filter((e) => e.branches.every((l) => l.branch === b.name)).length;
    out.push(`| ${b.name} | \`${b.ref}\` | \`${b.commit.slice(0, 7)}\` | ${b.personalities} | ${b.synths} | ${only} |`);
  }

  const hist = new Map<string, number>();
  for (const e of originals) for (const u of e.facts.ugens) hist.set(u, (hist.get(u) ?? 0) + 1);
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40);
  out.push('', '## UGens (top 40, files using each)', '', '| UGen | files |', '|---|---:|');
  for (const [u, n] of top) out.push(`| ${u} | ${n} |`);

  out.push('', '## Idioms (personalities)', '', '| idiom | files |', '|---|---:|');
  for (const idiom of ['pdef', 'ndef', 'synth', 'hybrid', 'none'] as const) {
    out.push(`| ${idiom} | ${pers.filter((e) => e.facts.idiom === idiom).length} |`);
  }

  const keys = new Map<string, number>();
  for (const e of pers) for (const k of e.facts.headerKeys) keys.set(k, (keys.get(k) ?? 0) + 1);
  const withHeader = pers.filter((e) => e.facts.headerKeys.length > 0).length;
  out.push('', '## Header-key coverage (personalities)', '', `${withHeader} of ${pers.length} have a leading header block with keys.`, '');
  out.push('| key | files |', '|---|---:|');
  for (const [k, n] of [...keys.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) out.push(`| ${k} | ${n} |`);

  const hooks = new Map<string, number>();
  for (const e of pers) for (const h of e.facts.hooks) hooks.set(h, (hooks.get(h) ?? 0) + 1);
  out.push('', '## Hooks defined (personalities)', '', '| hook | files |', '|---|---:|');
  for (const [h, n] of [...hooks.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) out.push(`| \`${h}\` | ${n} |`);

  const fields = new Map<string, number>();
  for (const e of pers) for (const f of e.facts.modelFields) fields.set(f, (fields.get(f) ?? 0) + 1);
  out.push('', '## Model fields read (personalities, top 30)', '', '| field | files |', '|---|---:|');
  for (const [f, n] of [...fields.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30)) out.push(`| ${f} | ${n} |`);

  const sampleUse = pers.filter((e) => e.facts.samples).length;
  const pct = pers.length ? ((100 * sampleUse) / pers.length).toFixed(1) : '0.0';
  out.push('', '## Sample use (personalities)', '', `${sampleUse} of ${pers.length} (${pct}%) call \`Buffer.read\`/\`readChannel\`/\`alloc\`.`);

  const sizes = pers.map((e) => e.size).sort((a, b) => a - b);
  const lines = pers.map((e) => e.lines).sort((a, b) => a - b);
  out.push('', '## Size percentiles (personalities)', '', '| | p10 | p25 | p50 | p75 | p90 | max |', '|---|---:|---:|---:|---:|---:|---:|');
  const ps = [10, 25, 50, 75, 90, 100];
  out.push(`| bytes | ${ps.map((p) => percentile(sizes, p)).join(' | ')} |`);
  out.push(`| lines | ${ps.map((p) => percentile(lines, p)).join(' | ')} |`);
  out.push('');
  return out.join('\n');
}
