import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rig } from './rig.ts';
import { buildView, dbfs, summarize } from '../src/view.ts';
import { StickIngest } from '../src/sticks.ts';
import { AirkitLink } from '../src/airkit.ts';
import { Show } from '../src/show.ts';
import { StateStore } from '../src/state.ts';
import { parseCast } from '../src/cast.ts';
import { parseScenes } from '../src/scenes.ts';
import { encodeMessage } from '../../scripts/lib/osc.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cast = parseCast('sticks: { ZL: { id: 1, label: A3 }, ZR: { id: 2, label: A4 }, CL: { id: 3, label: B1 }, CR: { id: 4, label: B2 } }\n').cast;
const rest = (id: string) => encodeMessage(`/${id}/IMUFusedData`, [0, 0, -9.8, 0, 0, 0, 1], 'fffffff');
const battery = (id: string, frac: number) => encodeMessage(`/${id}/Battery`, [3.7, frac], 'ff');

test('view in STANDBY, then during a fade, with status cells', async (t) => {
  const r = await rig(t);
  const sticks = new StickIngest({ port: 0, bindAddress: '127.0.0.1', cast: () => cast, onImu: () => {}, onAux: () => {}, log: () => {} });
  await sticks.start();
  t.after(() => sticks.close());
  const deps = { show: r.show, sticks, airkit: r.airkit, pedal: () => ({ state: 'NO PEDAL' as const, port: null, lastEvent: null }), castError: () => null };
  let v = buildView(deps);
  assert.equal(v.standby, true); assert.equal(v.scene, null); assert.equal(v.next?.id, 'A'); assert.equal(v.prev, null);
  assert.equal(v.wrists.ZL.label, 'A3'); assert.equal(v.wrists.ZL.who, 'Zubin · left'); assert.equal(v.wrists.ZL.state, 'NO SIGNAL');
  assert.deepEqual(v.status.map((s) => [s.key, s.tone]), [['PEDAL', 'warn'], ['STICKS', 'bad'], ['AIRKIT', 'ok'], ['AUDIO', 'ok'], ['BATTERY', 'inert'], ['CPU', 'ok']]);
  assert.equal(v.status.find((c) => c.key === 'CPU')?.value, '12%');
  assert.equal(v.slots.length, 9); assert.equal(v.slots[8]!.stick, 'aud');
  assert.equal(v.slots[0]!.stick, 'A3'); assert.equal(v.slots[0]!.live, true); assert.equal(v.slots[1]!.live, false);
  assert.equal(v.engine.online, true); assert.equal(typeof v.engine.deviceCount, 'number'); assert.ok(v.engine.levelsAgeMs !== null);
  assert.equal(v.sceneCount, 4); assert.equal(v.scenes.length, 4); assert.equal(v.scenes[0]!.summary, 'fade 0.1 · A3 A4 B2');
  assert.deepEqual(v.roster, r.airkit.roster);
  for (const id of ['1', '2', '3', '4']) sticks.handlePacket('127.0.0.1', rest(id));   // all four sticks alive
  assert.equal(buildView(deps).status.find((c) => c.key === 'STICKS')?.value, '4 / 4');
  sticks.handlePacket('127.0.0.1', battery('3', 0.15));
  assert.deepEqual(buildView(deps).status.find((c) => c.key === 'BATTERY'), { key: 'BATTERY', value: 'B1 15%', tone: 'warn' });
  const p = r.show.jump(3, 'admin');   // D, fade 0.4: ZR fades to COS_B, ZL stays silence
  v = buildView(deps);
  assert.equal(v.wrists.ZR.state, 'LOADING'); assert.equal(v.wrists.ZR.incoming, null); assert.equal(v.wrists.ZR.patch, 'silence');
  for (let i = 0; i < 50 && !r.show.wrists.ZR.fade; i++) await sleep(10);   // ready is polled every 100 ms
  await sleep(30);
  v = buildView(deps);
  assert.equal(v.scene?.id, 'D'); assert.equal(v.prev?.id, 'C'); assert.equal(v.next, null);
  assert.equal(v.wrists.ZR.state, 'FADING'); assert.ok(v.wrists.ZR.fadePct! > 0 && v.wrists.ZR.fadePct! < 1);
  assert.equal(v.wrists.ZR.incoming, 'COS_B'); assert.equal(v.wrists.ZR.patch, 'silence');
  assert.equal(v.wrists.ZL.state, 'SILENT'); assert.equal(v.wrists.ZL.incoming, null);
  assert.equal(v.lastCue?.targetId, 'D');
  await p;
  await sleep(500);
  v = buildView(deps);
  assert.equal(v.wrists.ZR.state, 'OK'); assert.equal(v.wrists.ZR.patch, 'COS_B'); assert.match(v.wrists.ZR.detail, /^slot 4 live$/);
  r.show.panic();
  v = buildView(deps);
  assert.equal(v.panicked, true);
  for (const w of ['ZL', 'ZR', 'CL', 'CR'] as const) assert.equal(v.wrists[w].state, 'PANIC');
  assert.doesNotThrow(() => JSON.stringify(buildView(deps)));
});

test('detail names params, the live slot and a preload', async (t) => {
  const r = await rig(t);
  const sticks = new StickIngest({ port: 0, cast: () => cast, onImu: () => {}, onAux: () => {}, log: () => {} });
  t.after(() => sticks.close());
  const deps = { show: r.show, sticks, airkit: r.airkit, pedal: () => ({ state: 'OK' as const, port: 'x', lastEvent: null }), castError: () => 'bad cast' };
  await r.show.next('page');   // A: ZL COS_A register=low; B next has ZL silence, ZR COS_A high (live change)
  await sleep(150);
  const v = buildView(deps);
  assert.equal(v.wrists.ZL.detail, 'register=low · slot 2 live');
  assert.equal(v.wrists.CL.detail, 'slot 5 live · preload COS_B');
  assert.equal(v.wrists.CL.standbyPatch, 'COS_B');
  assert.equal(v.castError, 'bad cast');
  assert.equal(v.status[0]!.tone, 'ok');
});

test('offline engine, no scenes, no sticks: buildView does not throw', (t) => {
  const airkit = new AirkitLink({ host: '127.0.0.1', port: 9, sourcePort: 0, log: () => {} });
  const show = new Show({ scenes: [], airkit, cast: () => cast, store: new StateStore(join(mkdtempSync(join(tmpdir(), 'cos-view-')), 's.json')), log: () => {} });
  const sticks = new StickIngest({ port: 0, cast: () => cast, onImu: () => {}, onAux: () => {}, log: () => {} });
  t.after(() => { sticks.close(); airkit.close(); show.dispose(); });
  sticks.handlePacket('127.0.0.1', battery('4', 0.08));
  const v = buildView({ show, sticks, airkit, pedal: () => ({ state: 'NO MIDI', port: null, lastEvent: null }), castError: () => null });
  assert.equal(v.sceneCount, 0); assert.equal(v.scene, null); assert.equal(v.next, null); assert.equal(v.prev, null); assert.equal(v.standby, true);
  assert.deepEqual(v.status.map((s) => [s.key, s.value, s.tone]), [['PEDAL', 'NO MIDI', 'warn'], ['STICKS', '0 / 4', 'bad'], ['AIRKIT', 'OFFLINE', 'bad'], ['AUDIO', 'OFFLINE', 'bad'], ['BATTERY', 'B2 8%', 'bad'], ['CPU', '—', 'inert']]);
  assert.equal(v.engine.online, false); assert.equal(v.engine.levelsAgeMs, null); assert.equal(v.engine.port, 9); assert.equal(v.engine.host, '127.0.0.1');
  assert.equal(v.wrists.CR.battery, 8); assert.equal(v.wrists.ZL.ageMs, -1); assert.equal(v.wrists.ZL.peak, 0);
  assert.equal(v.slots[0]!.tickAgeMs, -1); assert.equal(v.slots[0]!.name, '');
});

test('an engine that went offline shows no stale status', async (t) => {
  const r = await rig(t);
  const sticks = new StickIngest({ port: 0, cast: () => cast, onImu: () => {}, onAux: () => {}, log: () => {} });
  t.after(() => sticks.close());
  const deps = { show: r.show, sticks, airkit: r.airkit, pedal: () => ({ state: 'OK' as const, port: 'x', lastEvent: null }), castError: () => null };
  assert.ok(buildView(deps).slots.some((s) => s.ready), 'some slot ready while online');
  await r.fake.stop();
  for (let i = 0; i < 100 && r.airkit.online; i++) await sleep(20);   // pollMs 50 × 3 missed polls
  const v = buildView(deps);
  assert.equal(v.engine.online, false);
  assert.deepEqual(v.status.find((c) => c.key === 'AIRKIT'), { key: 'AIRKIT', value: 'OFFLINE', tone: 'bad' });
  assert.deepEqual(v.status.find((c) => c.key === 'CPU'), { key: 'CPU', value: '—', tone: 'inert' });
  assert.equal(v.engine.cpu, 0); assert.equal(v.engine.limiterOn, false); assert.equal(v.engine.deviceCount, 0);
  for (const s of v.slots) { assert.equal(s.ready, false); assert.equal(s.name, ''); assert.equal(s.tickAgeMs, -1); }
});

test('summarize and dbfs', () => {
  const scenes = parseScenes(`piece: T\nscenes:\n  - { id: A, name: x, fade: 6, sounds: { ZL: COS_A, CR: COS_A } }\n  - { id: B, name: y, sounds: { C: COS_X2H } }\n  - { id: C, name: z, sounds: {} }\n`, null).file!.scenes;
  assert.equal(summarize(scenes[0]!, cast), 'fade 6.0 · A3 B2');
  assert.equal(summarize(scenes[1]!, cast), 'fade 2.0 · Claire 2H');
  assert.equal(summarize(scenes[2]!, cast), 'fade 2.0 · all');
  assert.equal(dbfs(1), '0 dB'); assert.equal(dbfs(0.2), '−14 dB'); assert.equal(dbfs(0), '−inf'); assert.equal(dbfs(2), '6 dB');
});
