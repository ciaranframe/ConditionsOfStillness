// Integration test: actually shells out to sclang (~3 s per call). Skips when SCLANG is not
// installed on this machine rather than failing, so `npm test` stays green on a Mac without
// SuperCollider. The CLI's exit 2 paths (missing file, missing sclang) need no sclang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCheck, personalityPath, SCLANG } from '../src/sc.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'patch-compile.ts');
const CHECK_DIR = join(tmpdir(), 'cos-compile-check');
const checkFiles = () => (existsSync(CHECK_DIR) ? readdirSync(CHECK_DIR).filter((f) => f.endsWith('.scd')) : []);

function runCli(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('compileCheck: COS_Template parses', (t) => {
  if (!existsSync(SCLANG)) { t.skip('sclang not installed at ' + SCLANG); return; }
  const r = compileCheck(personalityPath('COS_Template'));
  assert.equal(r.ok, true, r.output);
});

test('compileCheck: a syntax error fails to parse', (t) => {
  if (!existsSync(SCLANG)) { t.skip('sclang not installed at ' + SCLANG); return; }
  const dir = mkdtempSync(join(tmpdir(), 'cos-compile-'));
  const bad = join(dir, 'Bad.sc');
  writeFileSync(bad, 'var x = ;\n');
  const r = compileCheck(bad);
  assert.equal(r.ok, false);
  assert.match(r.output, /PARSE FAILED|ERROR/);
});

test('CLI: exit 0 for COS_Template by bare name, exit 1 with error context for a broken .sc.tmp; no check file left', (t) => {
  if (!existsSync(SCLANG)) { t.skip('sclang not installed at ' + SCLANG); return; }
  const before = checkFiles();
  const ok = runCli(['COS_Template']);
  assert.equal(ok.code, 0, ok.out + ok.err);
  assert.match(ok.out, /COS_Template\.sc: parses/);

  const dir = mkdtempSync(join(tmpdir(), 'cos-compile-'));
  const bad = join(dir, 'COS_Bad.sc.tmp');
  writeFileSync(bad, '(\nvar x = ;\n)\n');
  const r = runCli([bad]);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /ERROR|PARSE FAILED/);
  assert.match(r.out, /COS_Bad\.sc\.tmp: does not parse/);
  assert.deepEqual(checkFiles(), before, 'the throwaway .scd was left behind');
});

test('CLI: exit 2 on usage, a missing file (bare names resolve under COS_REPO_ROOT) and a missing sclang', () => {
  assert.equal(runCli([]).code, 2);
  assert.equal(runCli(['COS_Template', 'extra']).code, 2);

  const root = mkdtempSync(join(tmpdir(), 'cos-compile-root-'));
  writeFileSync(join(root, 'airkit.lock'), 'branch=AirConditions\n');
  mkdirSync(join(root, 'airkit', 'personalities'), { recursive: true });
  const missing = runCli(['COS_Nowhere'], { COS_REPO_ROOT: root });
  assert.equal(missing.code, 2);
  assert.ok(missing.err.includes(join(root, 'airkit', 'personalities', 'COS_Nowhere.sc')), missing.err);

  writeFileSync(join(root, 'airkit', 'personalities', 'COS_Here.sc'), '1 + 1;\n');
  const noSclang = runCli(['COS_Here'], { COS_REPO_ROOT: root, COS_SCLANG: join(root, 'no-sclang') });
  assert.equal(noSclang.code, 2);
  assert.match(noSclang.err, /sclang not found/);
});
