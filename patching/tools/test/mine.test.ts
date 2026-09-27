import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listTree, readBlob } from '../src/git.ts';
import { analyse, mine } from '../src/mine.ts';

const SHARED = `/*
gestures:    [beat, shake]
description: shared across branches
family:      drone
*/
var m = ~model;
m.accelMassFilteredAttack = 0.98;
~init = ~init <> { Synth(\\x, [\\freq, SinOsc.kr(1)]) };
~next = { |d| if (m.accelMass > 0.3) { "hit".postln } };
`;

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

function put(repo: string, rel: string, text: string): void {
  const p = join(repo, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

// Branch one: Shared.sc, "Spaced Name.sc", Foo.sc, "Foo copy.sc" (same blob as Foo.sc),
// "Bar 2.sc" (a different blob whose stripped name is Bar), Bar.sc, a synth, a non-.sc file and
// the vendored standalone tree. Branch two: Shared.sc (same blob) at the same path, plus Only2.sc.
function fixture(): string {
  const repo = mkdtempSync(join(tmpdir(), 'cos-mine-repo-'));
  git(repo, 'init', '-q', '-b', 'one');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  put(repo, 'personalities/Shared.sc', SHARED);
  put(repo, 'personalities/Spaced Name.sc', 'Pdef(\\a, Pbind()); Ndef(\\b, { WhiteNoise.ar * 0.1 });\n');
  put(repo, 'personalities/Foo.sc', '~init = { Buffer.read(s, "x.wav") };\n');
  put(repo, 'personalities/Foo copy.sc', '~init = { Buffer.read(s, "x.wav") };\n');
  put(repo, 'personalities/Bar.sc', '// bar\n');
  put(repo, 'personalities/Bar 2.sc', '// bar two\n');
  put(repo, 'personalities/notes.txt', 'not sc\n');
  put(repo, 'personalities/sc_osx_standalone-3.7.0-template/Inner.sc', '// vendored\n');
  put(repo, 'synths/Tone.sc', 'SynthDef(\\tone, { Out.ar(0, LPF.ar(Saw.ar(220), 800)) }).add;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  git(repo, 'checkout', '-q', '--orphan', 'two');
  git(repo, 'rm', '-q', '-rf', '.');
  put(repo, 'personalities/Shared.sc', SHARED);
  put(repo, 'personalities/Only2.sc', '~onRoomState = { |s| };\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'two');
  return repo;
}

test('listTree parses NUL output, keeps spaced names, filters .sc and excludes the standalone tree', () => {
  const repo = fixture();
  const files = listTree(repo, 'one', ['personalities', 'synths']);
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    'personalities/Bar 2.sc',
    'personalities/Bar.sc',
    'personalities/Foo copy.sc',
    'personalities/Foo.sc',
    'personalities/Shared.sc',
    'personalities/Spaced Name.sc',
    'synths/Tone.sc',
  ]);
  const spaced = files.find((f) => f.path === 'personalities/Spaced Name.sc')!;
  assert.match(spaced.blob, /^[0-9a-f]{40}$/);
  assert.ok(spaced.size > 0);
  assert.match(readBlob(repo, spaced.blob), /Pdef/);
});

test('analyse extracts header keys, UGens, idiom, model reads, hooks, thresholds and samples', () => {
  const f = analyse(SHARED);
  assert.deepEqual(f.headerKeys, ['gestures', 'description', 'family']);
  assert.deepEqual(f.ugens, ['SinOsc']);
  assert.equal(f.idiom, 'synth');
  assert.deepEqual(f.modelFields, ['accelMass']);
  assert.deepEqual(f.hooks, ['~init', '~next']);
  assert.deepEqual(f.thresholds, [0.3]);
  assert.equal(f.samples, false);
  assert.equal(f.lines, 9);
  assert.equal(analyse('Pdef(\\a); Ndef(\\b);').idiom, 'hybrid');
  assert.equal(analyse('Ndef(\\b, { WhiteNoise.ar });').idiom, 'ndef');
  assert.equal(analyse('// Pdef(\\a)\n1+1;').idiom, 'none');
  assert.equal(analyse('~b = Buffer.alloc(s, 1024);').samples, true);
});

test('mine dedupes by blob, records every branch/path, flags duplicates and writes the outputs', () => {
  const repo = fixture();
  const out = mkdtempSync(join(tmpdir(), 'cos-mine-out-'));
  const index = mine({ repo, branches: ['one', 'two'], out });

  assert.deepEqual(
    index.branches.map((b) => [b.name, b.files]),
    [['one', 7], ['two', 2]],
  );

  const byName = (n: string) => index.entries.filter((e) => e.name === n);
  const shared = byName('Shared');
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].branches, [
    { branch: 'one', path: 'personalities/Shared.sc' },
    { branch: 'two', path: 'personalities/Shared.sc' },
  ]);
  // one raw copy per blob, at the first branch/path
  assert.ok(existsSync(join(out, 'one', 'personalities', 'Shared.sc')));
  assert.equal(existsSync(join(out, 'two', 'personalities', 'Shared.sc')), false);
  assert.equal(readFileSync(join(out, 'one', 'personalities', 'Spaced Name.sc'), 'utf8').includes('Pdef'), true);
  assert.ok(existsSync(join(out, 'two', 'personalities', 'Only2.sc')));

  assert.equal(byName('Spaced Name').length, 1);
  assert.equal(byName('Foo copy')[0].duplicateOf, 'Foo');
  assert.equal(byName('Foo')[0].duplicateOf, undefined);
  assert.equal(byName('Bar 2')[0].duplicateOf, 'Bar');
  assert.equal(byName('Bar')[0].duplicateOf, undefined);
  assert.equal(byName('Shared')[0].duplicateOf, undefined);
  // Foo.sc and "Foo copy.sc" share a blob: one raw copy (at the first path git lists), shared by both
  const fooRaw = [existsSync(join(out, 'one', 'personalities', 'Foo copy.sc')), existsSync(join(out, 'one', 'personalities', 'Foo.sc'))];
  assert.equal(fooRaw.filter(Boolean).length, 1);
  assert.equal(byName('Foo copy')[0].raw, byName('Foo')[0].raw);
  assert.equal(index.entries.some((e) => e.branches.some((b) => b.path.includes('sc_osx_standalone'))), false);
  assert.equal(byName('Shared')[0].facts.idiom, 'synth');

  const top = readdirSync(out).sort();
  assert.deepEqual(top, ['INDEX.md', 'index.json', 'one', 'stats.md', 'two']);
  const json = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
  assert.equal(json.entries.length, index.entries.length);
  const md = readFileSync(join(out, 'INDEX.md'), 'utf8');
  assert.match(md, /Spaced Name/);
  assert.match(md, /## one/);
  assert.match(md, /## two/);
  const stats = readFileSync(join(out, 'stats.md'), 'utf8');
  assert.match(stats, /SinOsc/);
  assert.equal(readdirSync(out).some((f) => f.endsWith('.tmp')), false);
});

test('the CLI mines a repo and exits 1 on a git error', () => {
  const repo = fixture();
  const out = mkdtempSync(join(tmpdir(), 'cos-mine-cli-'));
  const cli = new URL('../corpus-mine.ts', import.meta.url).pathname;
  const ok = execFileSync('node', [cli, '--repo', repo, '--branches', 'one,two', '--out', out, '--ref-prefix', ''], { encoding: 'utf8' });
  assert.match(ok, /one/);
  assert.ok(existsSync(join(out, 'index.json')));
  let code = 0;
  try {
    execFileSync('node', [cli, '--repo', repo, '--branches', 'nope', '--out', out, '--ref-prefix', ''], { stdio: 'pipe' });
  } catch (e) {
    code = (e as { status: number }).status;
  }
  assert.equal(code, 1);
});
