import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCast, assignStickInFile, wristOfStickId, whoOf, DEFAULT_CAST } from '../src/cast.ts';

const shipped = readFileSync(new URL('../../scenes/cast.yaml', import.meta.url), 'utf8');

test('the shipped cast.yaml parses with no errors and the documented defaults', () => {
  const { cast, errors } = parseCast(shipped);
  assert.deepEqual(errors, []);
  assert.equal(cast.network.stickPort, 8000);
  assert.equal(cast.network.webPort, 3000);
  assert.equal(cast.network.sourcePort, 9001);
  assert.deepEqual(cast.pedal.next, { note: 60 });
  assert.equal(cast.pedal.debounceMs, 150);
  assert.equal(cast.sticks.ZL.id, null);
  assert.equal(cast.sticks.CR.label, 'CR');
});

test('missing sections fall back to defaults with an error per problem', () => {
  const { cast, errors } = parseCast('sticks: { ZL: { id: 3 } }\npedal: { next: { note: "x" } }\n');
  assert.equal(cast.sticks.ZL.id, '3');
  assert.equal(cast.sticks.ZR.id, null);
  assert.equal(cast.network.webPort, DEFAULT_CAST.network.webPort);
  assert.ok(errors.some((e) => /pedal\.next/.test(e)));
});

test('two wrists with the same id is an error', () => {
  const { errors } = parseCast('sticks: { ZL: { id: 1 }, ZR: { id: 1 } }\n');
  assert.ok(errors.some((e) => /id 1 .*ZL.*ZR|ZL and ZR/.test(e)));
});

test('assignStickInFile edits in place and keeps comments', () => {
  const out = assignStickInFile(shipped, 'CL', '7', 'B1', '192.168.50.31');
  assert.match(out, /# Who is who/);
  const { cast } = parseCast(out);
  assert.deepEqual(cast.sticks.CL, { id: '7', label: 'B1', ip: '192.168.50.31' });
  assert.equal(cast.sticks.ZL.id, null);
  const cleared = assignStickInFile(out, 'CL', null);
  assert.equal(parseCast(cleared).cast.sticks.CL.id, null);
});

test('wristOfStickId and whoOf', () => {
  const { cast } = parseCast('sticks: { CR: { id: 4, label: B2 } }\n');
  assert.equal(wristOfStickId(cast, '4'), 'CR');
  assert.equal(wristOfStickId(cast, '9'), null);
  assert.equal(whoOf('ZL'), 'Zubin · left');
  assert.equal(whoOf('CR'), 'Claire · right');
});

test('assignStickInFile works when sticks: is absent, when the wrist is absent, and on an empty file', () => {
  for (const text of ['pedal: {}\n', 'sticks: { ZL: { id: 1 } }\n', '']) {
    const out = assignStickInFile(text, 'CL', '7', 'B1', null);
    const { cast, errors } = parseCast(out);
    assert.deepEqual(errors, [], text);
    assert.deepEqual(cast.sticks.CL, { id: '7', label: 'B1', ip: null }, text);
  }
  assert.equal(parseCast(assignStickInFile('sticks: { ZL: { id: 1 } }\n', 'CL', '7')).cast.sticks.ZL.id, '1');
});

test('parseCast on malformed yaml returns defaults with a yaml error', () => {
  const { cast, errors } = parseCast('sticks: [\n');
  assert.equal(cast.network.webPort, DEFAULT_CAST.network.webPort);
  assert.match(errors[0]!, /^yaml:/);
});
