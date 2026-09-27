// Integration test: actually shells out to sclang (~3 s per call). Skips when SCLANG is not
// installed on this machine rather than failing, so `npm test` stays green on a Mac without
// SuperCollider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCheck, personalityPath, SCLANG } from '../src/sc.ts';

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
