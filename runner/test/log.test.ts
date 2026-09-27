import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Log } from '../src/log.ts';

test('keeps the last max lines with a clock stamp and level', () => {
  const log = new Log(3, () => 0);
  log.line('a'); log.line('b', 'warn'); log.line('c'); log.line('d', 'error');
  const r = log.recent();
  assert.deepEqual(r.map((l) => l.msg), ['b', 'c', 'd']);
  assert.deepEqual(r.map((l) => l.level), ['warn', 'info', 'error']);
  assert.match(r[0]!.t, /^\d\d:\d\d:\d\d$/);
});

test('emits each line', () => {
  const log = new Log(10, () => 0, () => {});
  const seen: string[] = [];
  log.on('line', (l) => seen.push(l.msg));
  log.line('x');
  assert.deepEqual(seen, ['x']);
});
