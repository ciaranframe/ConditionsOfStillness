import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { encodeMessage } from '../../scripts/lib/osc.ts';
import { StickIngest, STICK_DEAD_MS } from '../src/sticks.ts';
import { parseCast } from '../src/cast.ts';

const cast = parseCast('sticks: { ZL: { id: 3, label: A3 }, ZR: { id: 4, label: A4, ip: 10.0.0.9 } }\n').cast;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ingest(now: { t: number }, onImu = (_w: string, _f: number[]) => {}) {
  const ing = new StickIngest({ port: 0, bindAddress: '127.0.0.1', cast: () => cast, onImu, onAux: () => {}, clock: () => now.t, log: () => {} });
  const port = await ing.start();
  const out = createSocket('udp4');
  const send = (addr: string, args: number[], types: string) => out.send(encodeMessage(addr, args, types), port, '127.0.0.1');
  return { ing, send, close: () => { ing.close(); out.close(); } };
}

test('maps /3/IMUFusedData to ZL, forwards seven floats, tracks liveness and battery', async () => {
  const now = { t: 1000 };
  const got: Array<[string, number[]]> = [];
  const { ing, send, close } = await ingest(now, (w, f) => got.push([w, f]));
  send('/3/IMUFusedData', [0, 0, -9.8, 0, 0, 0, 1], 'fffffff');
  send('/3/Battery', [3.9, 0.81], 'ff');
  send('/9/IMUFusedData', [0, 0, -9.8, 0, 0, 0, 1], 'fffffff');   // unmapped
  send('/3/IMUFusedData', [0, 0, 1, 2, 3], 'fffff');                // wrong arity: dropped
  await sleep(50);
  assert.equal(got.length, 1);
  assert.equal(got[0]![0], 'ZL');
  assert.deepEqual(got[0]![1].map((x) => Math.round(x * 100) / 100), [0, 0, -9.8, 0, 0, 0, 1]);
  const w = ing.wrists();
  assert.equal(w.ZL.alive, true);
  assert.equal(w.ZL.batteryPct, 81);
  assert.equal(w.ZL.label, 'A3');
  assert.equal(w.ZR.alive, false);
  assert.equal(w.CL.id, null);
  const heard = ing.heard();
  assert.deepEqual(heard.map((h) => [h.id, h.wrist]).sort(), [['9', null], ['3', 'ZL']].sort());
  now.t += STICK_DEAD_MS + 1;
  assert.equal(ing.wrists().ZL.alive, false);
  assert.equal(ing.aliveCount(), 0);
  close();
});

test('two IPs with one id are flagged conflict; ip mismatch against cast is flagged', async () => {
  const now = { t: 0 };
  const { ing, send, close } = await ingest(now);
  // 127.0.0.1 is the only address we can send from in a unit test; simulate the second IP
  // through the exported handler so the rule itself is tested.
  send('/4/IMUFusedData', [0, 0, -9.8, 0, 0, 0, 1], 'fffffff');
  await sleep(30);
  ing.handlePacket('10.0.0.77', encodeMessage('/4/IMUFusedData', [0, 0, -9.8, 0, 0, 0, 1], 'fffffff'));
  const h = ing.heard().filter((x) => x.id === '4');
  assert.equal(h.length, 2);
  assert.ok(h.every((x) => x.conflict));
  assert.equal(ing.wrists().ZR.ipMismatch, true);   // cast says 10.0.0.9
  close();
});

test('rate is packets per second over the last second', async () => {
  const now = { t: 0 };
  const { ing, send, close } = await ingest(now);
  for (let i = 0; i < 20; i++) { now.t += 10; send('/3/IMUFusedData', [0, 0, -9.8, 0, 0, 0, 1], 'fffffff'); }
  await sleep(60);
  const h = ing.heard().find((x) => x.id === '3')!;
  assert.ok(h.rateHz >= 15 && h.rateHz <= 25, `rate ${h.rateHz}`);
  close();
});
