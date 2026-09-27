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
  st.save({ sceneIndex: 2, trims: { ZL: 0, ZR: -6, CL: 0, CR: 0 }, masterDb: -3, panicked: true, liveSlots: { ZL: 1, ZR: 0, CL: 0, CR: 1 }, savedAt: 1234 });
  assert.deepEqual(st.load(), { sceneIndex: 2, trims: { ZL: 0, ZR: -6, CL: 0, CR: 0 }, masterDb: -3, panicked: true, liveSlots: { ZL: 1, ZR: 0, CL: 0, CR: 1 }, savedAt: 1234 });
  assert.deepEqual(readdirSync(join(path, '..')), ['current.json']);
});

test('load returns null on a corrupt file', () => {
  const path = fresh();
  const st = new StateStore(path);
  st.save({ sceneIndex: 0, trims: { ZL: 0, ZR: 0, CL: 0, CR: 0 }, masterDb: 0, panicked: false, liveSlots: { ZL: 0, ZR: 0, CL: 0, CR: 0 }, savedAt: 1 });
  writeFileSync(path, '{not json');
  assert.equal(st.load(), null);
});

test('a state file written before panicked and liveSlots existed loads as not panicked, every crossfader on 0', () => {
  const path = fresh();
  const st = new StateStore(path);
  st.save({ sceneIndex: 0, trims: { ZL: 0, ZR: 0, CL: 0, CR: 0 }, masterDb: 0, panicked: false, liveSlots: { ZL: 0, ZR: 0, CL: 0, CR: 0 }, savedAt: 1 });
  writeFileSync(path, JSON.stringify({ sceneIndex: 1, trims: { ZL: 0, ZR: 0, CL: 0, CR: 0 }, masterDb: 0, savedAt: 5 }));
  assert.equal(st.load()?.panicked, false);
  assert.deepEqual(st.load()?.liveSlots, { ZL: 0, ZR: 0, CL: 0, CR: 0 });
});
