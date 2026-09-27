import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from '../src/atomic.ts';

test('writeAtomic writes the file and leaves no .tmp behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-atomic-'));
  const file = join(dir, 'out.txt');
  writeAtomic(file, 'hello\n');
  assert.equal(readFileSync(file, 'utf8'), 'hello\n');
  assert.deepEqual(readdirSync(dir), ['out.txt']);
});

test('a second write replaces the content, still with no .tmp left behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-atomic-'));
  const file = join(dir, 'out.txt');
  writeAtomic(file, 'first\n');
  writeAtomic(file, 'second\n');
  assert.equal(readFileSync(file, 'utf8'), 'second\n');
  assert.deepEqual(readdirSync(dir), ['out.txt']);
});

test('writeAtomic creates the parent directory when it does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-atomic-'));
  const file = join(dir, 'nested', 'deeper', 'out.txt');
  assert.equal(existsSync(join(dir, 'nested')), false);
  writeAtomic(file, 'content\n');
  assert.equal(readFileSync(file, 'utf8'), 'content\n');
  assert.deepEqual(readdirSync(join(dir, 'nested', 'deeper')), ['out.txt']);
});
