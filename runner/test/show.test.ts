import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeAirkit, type FakeAirkit } from './fake-airkit.ts';
import { AirkitLink } from '../src/airkit.ts';
import { Show } from '../src/show.ts';
import { parseScenes, SILENCE } from '../src/scenes.ts';
import { parseCast } from '../src/cast.ts';
import { StateStore } from '../src/state.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROSTER = ['silence', 'COS_Template', 'COS_A', 'COS_B', 'COS_X2H', 'silence'];
export const SCENES = `
piece: T
defaults: { fade: 0.05, level: 0 }
scenes:
  - { id: A, name: One,   sounds: { ZL: { patch: COS_A, params: { register: low } }, ZR: COS_A, CR: { patch: COS_Template, level: -6 } } }
  - { id: B, name: Two,   sounds: { ZR: { patch: COS_A, params: { register: high } }, CL: COS_B } }
  - { id: C, name: Three, sounds: { C: COS_X2H, ZL: silence } }
  - { id: D, name: Four,  fade: 0.4, sounds: { ZR: COS_B } }
`;
const cast = parseCast('sticks: { ZL: { id: 1, label: A3 }, ZR: { id: 2, label: A4 }, CL: { id: 3, label: B1 }, CR: { id: 4, label: B2 } }\n').cast;

export async function rig(opts: { readyDelayMs?: number; readyTimeoutMs?: number; scenesText?: string; state?: object | null } = {}) {
  const fake = await fakeAirkit({ roster: ROSTER, readyDelayMs: opts.readyDelayMs ?? 10 });
  const airkit = new AirkitLink({ host: '127.0.0.1', port: fake.port, sourcePort: 0, pollMs: 50, log: () => {} });
  const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'cos-show-')), 'current.json'));
  if (opts.state) store.save(opts.state as never);
  const lines: string[] = [];
  const show = new Show({ scenes: parseScenes(opts.scenesText ?? SCENES, ROSTER).file!.scenes, airkit, cast: () => cast, store, log: (m, l) => lines.push(`${l ?? 'info'} ${m}`), readyTimeoutMs: opts.readyTimeoutMs ?? 1000, unloadGraceMs: 10 });
  await airkit.start();
  await show.boot();
  for (let i = 0; i < 50 && !airkit.online; i++) await sleep(20);
  await sleep(150);   // let boot's pushAll settle
  const port = (slot: number) => airkit.portOf(slot);
  const sends = (addr: string, from = 0) => fake.log.slice(from).filter((m) => m.address === addr).map((m) => m.args);
  const loads = (from = 0) => sends('/airkit/loadPersonality', from).map(([p, i]) => [Number(p) - port(1) + 1, ROSTER[Number(i)]]);   // [slot, patch]
  return { fake, airkit, show, store, lines, port, sends, loads, mark: () => fake.log.length, close: () => { show.dispose(); airkit.close(); fake.close(); } };
}

test('boots to STANDBY with scene A preloaded on the standby slots', async () => {
  const r = await rig();
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

test('NEXT to A: waits for ready, fires level and xfade together, unloads the outgoing slot, preloads B', async () => {
  const r = await rig();
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

test('A → B: same patch with new params is a live change (no load); CL crossfades using its preload', async () => {
  const r = await rig();
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

test('two-hand sound: left wrist loads with the partner slot, right wrist goes to silence', async () => {
  const r = await rig();
  await r.show.next('pedal'); await sleep(150);
  await r.show.next('pedal'); await sleep(150);
  const m = r.mark();
  await r.show.jump(2, 'admin'); await sleep(150);
  // after B: CL live on slot 6 (COS_B), CR live on slot 8 (COS_Template). C: CL ← COS_X2H on slot 5, partner = CR's target slot 7; CR ← silence on slot 7.
  assert.ok(r.loads().some(([s, p]) => s === 5 && p === 'COS_X2H'));
  assert.deepEqual(r.sends('/airkit/cos/partner').findLast((a) => a[0] === 5), [5, 7]);
  assert.deepEqual(r.show.wrists.CR.live, SILENCE);
  assert.equal(r.show.wrists.CL.live.partner, 'CR');
  assert.deepEqual(r.show.wrists.ZL.live, SILENCE);
  r.close();
});

test('a press mid-fade finishes the running fade in 0.1 s, unloads, then starts the new transition', async () => {
  const r = await rig();
  await r.show.jump(2, 'admin'); await sleep(150);
  const m = r.mark();
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

test('ends of the list: next at the last scene and back at STANDBY are noops; back at A returns to STANDBY', async () => {
  const r = await rig();
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

test('a newer cue supersedes one still waiting for ready (Review Focus 4)', async () => {
  const r = await rig({ readyDelayMs: 300, readyTimeoutMs: 2000 });
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

test('not ready within the timeout: fades anyway with a warning (ruling 4)', async () => {
  const r = await rig({ readyDelayMs: 600, readyTimeoutMs: 120 });
  const t0 = Date.now();
  assert.equal(await r.show.next('pedal'), 'done');
  assert.ok(Date.now() - t0 < 500);
  assert.ok(r.lines.some((l) => /^warn .*not ready after 120 ms/.test(l)), r.lines.join('\n'));
  assert.ok(r.sends('/airkit/cos/xfade').some(([w]) => w === 'ZL'));
  r.close();
});
