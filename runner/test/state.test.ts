import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../src/state.ts';

const fresh = () => join(mkdtempSync(join(tmpdir(), 'cos-state-')), 'nested', 'current.json');

test('load returns null when nothing was saved', () => {
  assert.equal(new StateStore(fresh()).load(), null);
});

test('save then load round-trips and leaves no temp file', () => {
  const path = fresh();
  const st = new StateStore(path);
  st.save({ sceneIndex: 2, trims: { ZL: 0, ZR: -6, CL: 0, CR: 0 }, masterDb: -3, savedAt: 1234 });
  assert.deepEqual(st.load(), { sceneIndex: 2, trims: { ZL: 0, ZR: -6, CL: 0, CR: 0 }, masterDb: -3, savedAt: 1234 });
  assert.deepEqual(readdirSync(join(path, '..')), ['current.json']);
});

test('load returns null on a corrupt file', () => {
  const path = fresh();
  const st = new StateStore(path);
  st.save({ sceneIndex: 0, trims: { ZL: 0, ZR: 0, CL: 0, CR: 0 }, masterDb: 0, savedAt: 1 });
  writeFileSync(path, '{not json');
  assert.equal(st.load(), null);
});
