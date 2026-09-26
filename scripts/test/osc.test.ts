import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decodeMessage, flattenPacket, encodeBundle } from '../lib/osc.ts';

test('round-trips a message with float, string and explicit int', () => {
  const buf = encodeMessage('/airkit/cos/xfade', ['ZL', 1, 2.5], 'sif');
  const m = decodeMessage(buf);
  assert.equal(m.address, '/airkit/cos/xfade');
  assert.equal(m.types, 'sif');
  assert.deepEqual(m.args, ['ZL', 1, 2.5]);
});

test('numbers encode as floats by default', () => {
  const m = decodeMessage(encodeMessage('/x', [9001, 0]));
  assert.equal(m.types, 'ii');
  assert.deepEqual(m.args, [9001, 0]);
});

test('flattenPacket unpacks a bundle into its messages', () => {
  const b = encodeBundle([encodeMessage('/a', [1]), encodeMessage('/b', ['x'])]);
  const ms = flattenPacket(b);
  assert.deepEqual(ms.map((m) => m.address), ['/a', '/b']);
});

test('decodeMessage rejects an unterminated address', () => {
  assert.throws(() => decodeMessage(Buffer.from('/abc')), /osc/);
});
