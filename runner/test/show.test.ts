import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SILENCE } from '../src/scenes.ts';
import { rig } from './rig.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('boots to STANDBY with scene A preloaded on the standby slots', async (t) => {
  const r = await rig(t);
  assert.equal(r.show.sceneIndex, -1);
  assert.equal(r.show.current.id, 'STANDBY');
  // every live slot (1,3,5,7) silence; A's sounds preloaded on 2,4,8; CL keeps silence (A does not mention CL)
  const l = r.loads();
  assert.ok(l.some(([s, p]) => s === 2 && p === 'COS_A'), `ZL preload: ${JSON.stringify(l)}`);
  assert.ok(l.some(([s, p]) => s === 4 && p === 'COS_A'));
  assert.ok(l.some(([s, p]) => s === 8 && p === 'COS_Template'));
  assert.ok(!l.some(([s, p]) => s === 6 && p !== 'silence'));
  assert.deepEqual(r.sends('/airkit/cos/params').findLast((a) => a[0] === 2), [2, 'register', 'low']);
  assert.deepEqual(r.show.wrists.ZL.standby, { patch: 'COS_A', params: { register: 'low' }, level: 0, partner: null });
  r.close();
});

test('NEXT to A: waits for ready, fires level and xfade together, unloads the outgoing slot, preloads B', async (t) => {
  const r = await rig(t);
  const m = r.mark();
  assert.equal(await r.show.next('pedal'), 'done');
  await sleep(20);
  assert.equal(r.show.sceneIndex, 0);
  assert.equal(r.show.lastCue?.action, 'next');
  const xf = r.sends('/airkit/cos/xfade', m);
  assert.deepEqual(xf.sort(), [['CR', 1, 0.05], ['ZL', 1, 0.05], ['ZR', 1, 0.05]]);
  const lv = r.sends('/airkit/cos/level', m);
  assert.ok(lv.some(([w, g]) => w === 'CR' && Math.abs(Number(g) - 0.501) < 0.01), 'CR level −6 dB');
  assert.equal(r.show.wrists.ZL.liveSlot, 1);
  assert.equal(r.show.wrists.ZL.live.patch, 'COS_A');
  assert.ok(r.show.wrists.ZL.fade, 'fade in flight');
  await sleep(150);
  assert.equal(r.show.wrists.ZL.fade, null);
  const after = r.loads(m);
  assert.ok(after.some(([s, p]) => s === 1 && p === 'silence'), 'outgoing ZL slot 1 unloaded');
  assert.ok(after.some(([s, p]) => s === 6 && p === 'COS_B'), 'B preloaded: CL on slot 6');
  assert.ok(!after.some(([s, p]) => s === 1 && p !== 'silence'), 'B has no new ZL sound, nothing preloaded on slot 1');
  assert.equal(r.store.load()?.sceneIndex, 0);
  r.close();
});

test('A → B: same patch with new params is a live change (no load); CL crossfades using its preload', async (t) => {
  const r = await rig(t);
  await r.show.next('pedal'); await sleep(150);
  const m = r.mark();
  await r.show.next('pedal'); await sleep(150);
  const zr = r.loads(m).filter(([s]) => s === 3 || s === 4);
  assert.deepEqual(zr, [], 'ZR not reloaded');
  assert.ok(r.sends('/airkit/cos/params', m).some((a) => a[0] === 4 && a[2] === 'high'), 'params sent to ZR live slot 4');
  const cl = r.loads(m).filter(([s, p]) => (s === 5 || s === 6) && p === 'COS_B');
  assert.deepEqual(cl, [], 'CL preload reused, not loaded again');
  assert.deepEqual(r.sends('/airkit/cos/xfade', m), [['CL', 1, 0.05]]);
  r.close();
});

test('two-hand sound: left wrist loads with the partner slot, right wrist goes to silence', async (t) => {
  const r = await rig(t);
  await r.show.next('pedal'); await sleep(150);
  await r.show.next('pedal'); await sleep(150);
  await r.show.jump(2, 'admin'); await sleep(150);
  // after B: CL live on slot 6 (COS_B), CR live on slot 8 (COS_Template). C: CL ← COS_X2H on slot 5, partner = CR's target slot 7; CR ← silence on slot 7.
  assert.ok(r.loads().some(([s, p]) => s === 5 && p === 'COS_X2H'));
  assert.deepEqual(r.sends('/airkit/cos/partner').findLast((a) => a[0] === 5), [5, 7]);
  assert.deepEqual(r.show.wrists.CR.live, SILENCE);
  assert.equal(r.show.wrists.CL.live.partner, 'CR');
  assert.deepEqual(r.show.wrists.ZL.live, SILENCE);
  r.close();
});

test('a press mid-fade finishes the running fade in 0.1 s, unloads, then starts the new transition', async (t) => {
  const r = await rig(t);
  await r.show.jump(2, 'admin'); await sleep(150);
  const p = r.show.next('pedal');            // to D: fade 0.4, ZR ← COS_B
  await sleep(100);
  assert.ok(r.show.wrists.ZR.fade, 'ZR fading');
  await p;
  const m2 = r.mark();
  await r.show.back('pedal'); await sleep(20);               // back to C mid-fade: ZR wants COS_X2H? no — C's ZR is COS_A (kept from B)
  // ZR's slot history: boot live slot 3 (idx 0), A/C put COS_A on slot 4 (idx 1), D fades to COS_B on slot 3 (idx 0).
  const xf = r.sends('/airkit/cos/xfade', m2);
  assert.deepEqual(xf[0], ['ZR', 0, 0.1], 'finish the D fade fast on its own pos (idx 0)');
  const l = r.loads(m2);
  assert.equal(l[0]![0], 4); assert.equal(l[0]![1], 'silence');   // outgoing slot 4 unloaded synchronously
  assert.ok(l.some(([s, p2]) => s === 4 && p2 === 'COS_A'), 'then COS_A loads into slot 4');
  assert.deepEqual(xf[xf.length - 1], ['ZR', 1, 0.05]);
  await sleep(500);
  assert.equal(r.show.wrists.ZR.fade, null);
  r.close();
});

test('ends of the list: next at the last scene and back at STANDBY are noops; back at A returns to STANDBY', async (t) => {
  const r = await rig(t);
  assert.equal(await r.show.back('pedal'), 'noop');
  await r.show.jump(3, 'admin');
  assert.equal(await r.show.next('pedal'), 'noop');
  assert.equal(r.show.sceneIndex, 3);
  await r.show.jump(0, 'admin'); await sleep(100);
  assert.equal(await r.show.back('pedal'), 'done');
  assert.equal(r.show.sceneIndex, -1);
  await sleep(100);
  for (const w of ['ZL', 'ZR', 'CL', 'CR'] as const) assert.deepEqual(r.show.wrists[w].live, SILENCE);
  r.close();
});

test('a newer cue supersedes one still waiting for ready (Review Focus 4)', async (t) => {
  const r = await rig(t, { readyDelayMs: 300, readyTimeoutMs: 2000 });
  const m = r.mark();
  const first = r.show.next('pedal');
  await sleep(20);
  const second = r.show.next('pedal');
  assert.equal(await first, 'superseded');
  assert.equal(await second, 'done'); await sleep(20);
  assert.equal(r.show.sceneIndex, 1);
  const xf = r.sends('/airkit/cos/xfade', m);
  assert.equal(xf.filter(([w]) => w === 'CL').length, 1, 'CL crossfaded exactly once, to B');
  assert.equal(r.show.wrists.CL.live.patch, 'COS_B');
  r.close();
});

test('not ready within the timeout: fades anyway with a warning (ruling 4)', async (t) => {
  const r = await rig(t, { readyDelayMs: 600, readyTimeoutMs: 120 });
  const t0 = Date.now();
  assert.equal(await r.show.next('pedal'), 'done');
  assert.ok(Date.now() - t0 < 500);
  assert.ok(r.lines.some((l) => /^warn .*not ready after 120 ms/.test(l)), r.lines.join('\n'));
  assert.ok(r.sends('/airkit/cos/xfade').some(([w]) => w === 'ZL'));
  r.close();
});

test('engine restart during a ready wait: the waiting cue is superseded and the target scene is pushed', async (t) => {
  const r = await rig(t, { readyDelayMs: 400, readyTimeoutMs: 1500 });
  const p = r.show.next('pedal');            // to A, waiting for ready
  await sleep(50);
  await r.fake.stop();
  await sleep(200);                          // offline (3 polls of 50 ms)
  await r.fake.start();
  for (let i = 0; i < 50 && !r.airkit.online; i++) await sleep(20);
  assert.equal(await p, 'superseded');
  await sleep(600);
  assert.equal(r.show.sceneIndex, 0);
  for (const w of ['ZL', 'ZR', 'CR'] as const) assert.equal(r.show.wrists[w].live.patch, w === 'CR' ? 'COS_Template' : 'COS_A');
  assert.equal(r.fake.devices.get(r.port(1 + r.show.wrists.ZL.liveSlot))?.name, 'COS_A', 'A live on ZL live slot after the re-push');
  assert.ok(r.loads().some(([s, p2]) => s === 6 && p2 === 'COS_B'), 'B preloaded after the re-push');
  assert.equal(r.show.wrists.ZL.fade, null);
  r.close();
});

test('a stale standby preload is unloaded when the next scene no longer wants it', async (t) => {
  const r = await rig(t);
  await r.show.jump(0, 'admin'); await sleep(150);
  assert.equal(r.fake.devices.get(r.port(6))?.name, 'COS_B', 'B preloaded on CL slot 6 while in A');
  assert.equal(await r.show.back('pedal'), 'done');
  await sleep(2200);                         // STANDBY's fade is 2 s; the stale unload runs when it ends
  assert.equal(r.show.sceneIndex, -1);
  // In STANDBY the next scene is A, whose CL is silence: the B preload on slot 6 is stale.
  assert.equal(r.fake.devices.get(r.port(6))?.name, 'silence');
  assert.equal(r.show.wrists.CL.standby, null);
  r.close();
});
