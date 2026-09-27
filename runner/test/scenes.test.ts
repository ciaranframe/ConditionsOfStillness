import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScenes, parseRosterFile, sameSound, dbToGain, standbyScene, SILENCE, slotsOf } from '../src/scenes.ts';

const ROSTER = ['silence', 'COS_Breath', 'COS_Skin', 'COS_Membrane2H', 'COS_Template'];
const base = `
piece: Test
defaults: { fade: 2.0, level: 0 }
scenes:
  - id: A
    name: One
    fade: 6
    sounds:
      ZL: { patch: COS_Breath, params: { register: low, rate: 2 } }
      ZR: COS_Breath
      CR: { patch: COS_Skin, level: -6 }
  - id: B
    name: Two
    fade: 0.1
    sounds:
      C: COS_Membrane2H
  - id: C
    name: Three
    sounds:
      ZL: silence
`;

test('resolves every wrist in every scene; unmentioned wrists keep their sound', () => {
  const { file, errors } = parseScenes(base, ROSTER);
  assert.deepEqual(errors, []);
  const [a, b, c] = file!.scenes;
  assert.equal(a!.index, 0);
  assert.deepEqual(a!.sounds.ZL, { patch: 'COS_Breath', params: { register: 'low', rate: 2 }, level: 0, partner: null });
  assert.deepEqual(a!.sounds.CL, SILENCE);
  assert.equal(a!.sounds.CR.level, -6);
  assert.deepEqual(a!.mentions, ['ZL', 'ZR', 'CR']);
  // B: two-hand on Claire — CL gets the patch with CR as partner, CR gets silence; Zubin keeps A's sounds
  assert.deepEqual(b!.sounds.CL, { patch: 'COS_Membrane2H', params: {}, level: 0, partner: 'CR' });
  assert.deepEqual(b!.sounds.CR, SILENCE);
  assert.deepEqual(b!.sounds.ZL, a!.sounds.ZL);
  assert.deepEqual(b!.mentions, ['CL', 'CR']);
  assert.equal(b!.fade, 0.1);
  // C: default fade, ZL to silence, others kept
  assert.equal(c!.fade, 2.0);
  assert.deepEqual(c!.sounds.ZL, SILENCE);
  assert.deepEqual(c!.sounds.CL, b!.sounds.CL);
});

test('validation errors name the scene and the problem', () => {
  const bad = `
piece: T
scenes:
  - id: A
    name: dup
    fade: 40
    sounds: { ZL: COS_Nope, Z: COS_Breath, ZR: COS_Membrane2H }
  - id: A
    name: dup2
    fade: 0.01
    sounds: { CL: { patch: COS_Skin, params: { bad: [1, 2] } } }
`;
  const { file, errors } = parseScenes(bad, ROSTER);
  assert.equal(file, null);
  const text = errors.join('\n');
  assert.match(text, /duplicate id A/);
  assert.match(text, /A: fade 40 .*0\.05.*30/);
  assert.match(text, /A: ZL: unknown patch COS_Nope/);
  assert.match(text, /A: Z: COS_Breath is not a 2H patch/);
  assert.match(text, /A: ZR: 2H patch COS_Membrane2H must be on Z or C/);
  assert.match(text, /A: fade 0\.01|A \(2\): fade 0\.01/);
  assert.match(text, /CL: param bad must be a string or number/);
});

test('without a roster, patch names are not checked', () => {
  const { file, errors } = parseScenes(base, null);
  assert.deepEqual(errors, []);
  assert.equal(file!.scenes.length, 3);
});

test('rejects non-yaml and missing scenes', () => {
  assert.match(parseScenes('scenes: [', ROSTER).errors[0]!, /yaml/i);
  assert.match(parseScenes('piece: x', ROSTER).errors[0]!, /scenes/);
});

test('parseRosterFile reads quoted names from list_conditions.sc', () => {
  const sc = `(\n\t[\n\t\t"silence",\n\t\t"COS_Template",\n\t\t"silence",\n\t]\n)`;
  assert.deepEqual(parseRosterFile(sc), ['silence', 'COS_Template', 'silence']);
});

test('sameSound ignores params and level; dbToGain; standby; slots', () => {
  const a = { patch: 'X', params: { r: 1 }, level: 0, partner: null };
  assert.equal(sameSound(a, { ...a, params: {}, level: -9 }), true);
  assert.equal(sameSound(a, { ...a, partner: 'ZR' }), false);
  assert.equal(dbToGain(0), 1);
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.001);
  assert.equal(dbToGain(-60), 0);
  assert.equal(dbToGain(20), 4);
  assert.equal(standbyScene().index, -1);
  assert.deepEqual(standbyScene().sounds.CR, SILENCE);
  assert.deepEqual(slotsOf('CL'), [5, 6]);
});
