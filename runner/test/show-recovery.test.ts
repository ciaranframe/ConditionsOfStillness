import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rig } from './rig.ts';
import { SILENCE } from '../src/scenes.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trims = { ZL: 0, ZR: -6, CL: 0, CR: 0 };

test('boot restores a recent state and re-pushes in the spec order', async (t) => {
  const r = await rig(t, { state: { sceneIndex: 1, trims, masterDb: -3, savedAt: Date.now() - 60_000 } });
  assert.equal(r.show.sceneIndex, 1);
  assert.equal(r.show.trims.ZR, -6);
  const order = r.fake.log.map((m) => m.address);
  const first = (a: string) => order.indexOf(a);
  assert.ok(first('/airkit/cos/master') < first('/airkit/cos/level'), 'master before levels');
  assert.ok(first('/airkit/cos/level') < first('/airkit/cos/params'), 'levels before params');
  assert.ok(first('/airkit/cos/params') < first('/airkit/loadPersonality'), 'params before loads');
  assert.ok(Math.abs(Number(r.sends('/airkit/cos/master')[0]![0]) - 0.708) < 0.01);
  const zr = r.sends('/airkit/cos/level').find(([w]) => w === 'ZR')!;
  assert.ok(Math.abs(Number(zr[1]) - 0.501) < 0.01, 'ZR level includes the −6 dB trim');
  assert.ok(r.loads().some(([s, p]) => s === 1 && p === 'COS_A'), 'B: ZL live COS_A on slot 1');
  assert.ok(r.loads().some(([s, p]) => s === 5 && p === 'COS_B'));
  assert.deepEqual(r.loads().filter(([s]) => s === 9), [], 'slot 9 already on silence on a fresh engine: no load (re-push if different)');
  assert.equal(r.fake.devices.get(r.port(9))?.name, 'silence');
  assert.ok(r.loads().some(([s, p]) => s === 6 && p === 'COS_X2H'), 'C preloaded for CL');
  r.close();
});

test('boot ignores a stale state: STANDBY, trims kept', async (t) => {
  const r = await rig(t, { state: { sceneIndex: 2, trims, masterDb: -3, savedAt: Date.now() - 20 * 60_000 } });
  assert.equal(r.show.sceneIndex, -1);
  assert.equal(r.show.masterDb, -3);
  r.close();
});

test('engine dead → alive mid-fade: timers cancelled, wrists re-pushed at their targets (Review Focus 3)', async (t) => {
  const r = await rig(t, { scenesText: undefined });
  await r.show.jump(2, 'admin'); await sleep(150);
  const p = r.show.next('pedal');   // D: fade 0.4
  await sleep(60);
  await r.fake.stop();
  await p;
  await sleep(200);                 // > 3 polls of 50 ms → offline
  assert.equal(r.airkit.online, false);
  const fresh = r.mark();           // the fake keeps its log across stop/start; judge only the fresh engine
  await r.fake.start();
  for (let i = 0; i < 50 && !r.airkit.online; i++) await sleep(20);
  await sleep(300);
  const xf = r.sends('/airkit/cos/xfade');
  const zr = xf.filter(([w]) => w === 'ZR');
  assert.deepEqual(zr[zr.length - 1]!.slice(1), [r.show.wrists.ZR.liveSlot, 0.1], 'ZR parked at its target pos');
  assert.equal(r.show.wrists.ZR.fade, null);
  assert.equal(r.fake.devices.get(r.port(3 + r.show.wrists.ZR.liveSlot))?.name, 'COS_B');
  const silenceOnLive = r.loads(fresh).filter(([s, p]) => s === 3 + r.show.wrists.ZR.liveSlot && p === 'silence');
  assert.equal(silenceOnLive.length, 0, 'no stale unload hit the live slot on the fresh engine');
  r.close();
});

test('panic cancels pending unloads and silences the model; resume re-pushes the scene and the audition level', async (t) => {
  const r = await rig(t);
  await r.show.jump(3, 'admin');    // D: fade 0.4 → unload timers pending
  await sleep(50);
  const m = r.mark();
  r.show.panic();
  await sleep(20);                  // UDP delivery to the fake
  assert.equal(r.fake.panics, 1);
  assert.equal(r.show.panicked, true);
  for (const w of ['ZL', 'ZR', 'CL', 'CR'] as const) { assert.deepEqual(r.show.wrists[w].live, SILENCE); assert.equal(r.show.wrists[w].fade, null); }
  await sleep(600);
  assert.deepEqual(r.loads(m), [], 'nothing loaded after panic until resume');
  const m2 = r.mark();
  await r.show.resume();
  await sleep(150);
  assert.equal(r.show.panicked, false);
  assert.equal(r.show.sceneIndex, 3);
  assert.ok(r.loads(m2).some(([s, p]) => p === 'COS_B' && (s === 3 || s === 4)));
  assert.ok(r.sends('/airkit/cos/level', m2).some(([w, g]) => w === 'audition' && Number(g) === 1));
  r.close();
});

test('audition loads slot 9 and mirrors the chosen wrist; clearing returns slot 9 to silence', async (t) => {
  const r = await rig(t);
  const m = r.mark();
  r.show.audition('CL', 'COS_B');
  await sleep(50);
  assert.equal(r.show.auditionWrist, 'CL');
  assert.ok(r.loads(m).some(([s, p]) => s === 9 && p === 'COS_B'));
  assert.deepEqual(r.sends('/airkit/cos/audition', m), [['CL']]);
  r.show.audition('CL', null);
  await sleep(50);
  assert.equal(r.show.auditionWrist, null);
  assert.ok(r.loads(m).some(([s, p]) => s === 9 && p === 'silence'));
  r.close();
});

test('reloadWrist, setTrim and setMaster', async (t) => {
  const r = await rig(t);
  await r.show.next('pedal'); await sleep(150);
  const m = r.mark();
  r.show.reloadWrist('ZL');
  await sleep(20);                  // UDP delivery to the fake
  const l = r.loads(m).filter(([s]) => s === 2);
  assert.deepEqual(l, [[2, 'silence'], [2, 'COS_A']]);
  r.show.setTrim('ZL', -12);
  await sleep(20);
  const lv = r.sends('/airkit/cos/level', m).find(([w]) => w === 'ZL')!;
  assert.ok(Math.abs(Number(lv[1]) - 0.251) < 0.01);
  r.show.setMaster(-20);
  await sleep(20);
  assert.ok(Math.abs(Number(r.sends('/airkit/cos/master', m)[0]![0]) - 0.1) < 0.01);
  assert.equal(r.store.load()?.trims.ZL, -12);
  assert.equal(r.store.load()?.masterDb, -20);
  r.close();
});

test('reconcile re-issues a drifted seat three times then gives up', async (t) => {
  const r = await rig(t);
  await r.show.next('pedal'); await sleep(150);
  const port = r.port(2);
  const m = r.mark();
  r.fake.devices.get(port)!.name = 'silence';   // the engine forgot ZL's live patch
  await sleep(120);
  assert.ok(r.loads(m).some(([s, p]) => s === 2 && p === 'COS_A'), 'reloaded');
  r.fake.devices.get(port)!.name = 'silence';
  r.fake.readyOverride = { [port]: 'silence' };  // keep lying: every load lands as silence
  await sleep(400);
  const n = r.loads(m).filter(([s, p]) => s === 2 && p === 'COS_A').length;
  assert.ok(n >= 3 && n <= 4, `attempts ${n}`);
  assert.ok(r.lines.some((l) => /giving up/.test(l)));
  r.close();
});

test('replaceScenes keeps the current scene by id and re-cues if its sounds changed; drops to STANDBY when it is gone (Review Focus 2)', async (t) => {
  const r = await rig(t);
  await r.show.jump(1, 'admin'); await sleep(150);
  const { parseScenes } = await import('../src/scenes.ts');
  const changed = parseScenes(`
piece: T
defaults: { fade: 0.05, level: 0 }
scenes:
  - { id: A, name: One, sounds: { ZL: COS_A } }
  - { id: B, name: Two, sounds: { ZL: COS_B } }
`, ['silence', 'COS_A', 'COS_B', 'silence']).file!.scenes;
  const m = r.mark();
  await r.show.replaceScenes(changed);
  await sleep(150);
  assert.equal(r.show.sceneIndex, 1);
  assert.equal(r.show.wrists.ZL.live.patch, 'COS_B');
  assert.ok(r.sends('/airkit/cos/xfade', m).some(([w]) => w === 'ZL'));
  const gone = parseScenes(`piece: T\nscenes:\n  - { id: Z, name: Only, sounds: { ZL: COS_A } }\n`, ['silence', 'COS_A', 'silence']).file!.scenes;
  await r.show.replaceScenes(gone);
  await sleep(100);
  assert.equal(r.show.sceneIndex, -1);
  assert.deepEqual(r.show.wrists.ZL.live, SILENCE);
  r.close();
});

test('a cue issued while pushAll waits for the devices is not clobbered by the re-push', async (t) => {
  const r = await rig(t);
  const p = r.show.pushAll();       // awaits ensureDevices (rest-pose + getSeats round trip)
  await sleep(20);
  const cue = r.show.next('pedal'); // → A, during the ensureDevices wait
  await p; await cue;
  await sleep(300);
  assert.equal(r.show.sceneIndex, 0);
  assert.equal(r.show.wrists.ZL.live.patch, 'COS_A');
  assert.equal(r.fake.devices.get(r.port(1 + r.show.wrists.ZL.liveSlot))?.name, 'COS_A');
  assert.equal(r.fake.devices.get(r.port(3 + r.show.wrists.ZR.liveSlot))?.name, 'COS_A');
  assert.equal(r.fake.devices.get(r.port(7 + r.show.wrists.CR.liveSlot))?.name, 'COS_Template');
  for (const w of ['ZL', 'ZR', 'CL', 'CR'] as const) { assert.equal(r.show.wrists[w].fade, null, `${w} fade`); assert.equal(r.show.wrists[w].loading, false, `${w} loading`); }
  r.close();
});

test('reconcile ignores a seats reply asked before our load: no spurious reloads through cues and a re-push', async (t) => {
  const r = await rig(t);
  for (let i = 0; i < 3; i++) { await r.show.next('pedal'); await sleep(300); }
  await r.fake.stop(); await sleep(200); await r.fake.start();
  for (let i = 0; i < 50 && !r.airkit.online; i++) await sleep(20);
  await sleep(400);
  assert.deepEqual(r.lines.filter((l) => /reloading|giving up/.test(l)), []);
  r.close();
});

test('replaceScenes while panicked stays silent; resume brings the new scene back', async (t) => {
  const r = await rig(t);
  await r.show.jump(1, 'admin'); await sleep(150);
  r.show.panic();
  await sleep(50);
  const { parseScenes } = await import('../src/scenes.ts');
  const changed = parseScenes(`
piece: T
defaults: { fade: 0.05, level: 0 }
scenes:
  - { id: A, name: One, sounds: { ZL: COS_A } }
  - { id: B, name: Two, sounds: { ZL: COS_B } }
`, ['silence', 'COS_A', 'COS_B', 'silence']).file!.scenes;
  const m = r.mark();
  await r.show.replaceScenes(changed);
  await sleep(150);
  assert.equal(r.show.panicked, true);
  assert.equal(r.fake.panics, 1);
  assert.equal(r.show.sceneIndex, 1);
  assert.deepEqual(r.loads(m), [], 'nothing loaded while panicked');
  for (const w of ['ZL', 'ZR', 'CL', 'CR'] as const) assert.deepEqual(r.show.wrists[w].live, SILENCE);
  assert.ok(r.lines.some((l) => /scenes file reloaded while panicked — not re-cued/.test(l)));
  const m2 = r.mark();
  await r.show.resume();
  await sleep(150);
  assert.equal(r.show.panicked, false);
  assert.equal(r.show.wrists.ZL.live.patch, 'COS_B');
  assert.ok(r.loads(m2).some(([s, p]) => (s === 1 || s === 2) && p === 'COS_B'));
  r.close();
});

test('cues are refused while panicked; only resume clears the panic', async (t) => {
  const r = await rig(t);
  await r.show.next('pedal'); await sleep(150);
  r.show.panic();
  await sleep(30);
  const m = r.mark();
  assert.equal(await r.show.next('pedal'), 'noop');
  assert.equal(await r.show.jump(2, 'admin'), 'noop');
  assert.equal(await r.show.back('key'), 'noop');
  await sleep(50);
  assert.equal(r.show.panicked, true);
  assert.equal(r.show.sceneIndex, 0);
  assert.deepEqual(r.loads(m), [], 'no loadPersonality while panicked');
  assert.equal(r.lines.filter((l) => /cue ignored — PANIC, resume from Admin/.test(l)).length, 3, 'one line per press');
  assert.equal(r.store.load()?.panicked, true, 'panic persisted');
  await r.show.resume();
  await sleep(150);
  assert.equal(r.show.panicked, false);
  assert.equal(r.store.load()?.panicked, false);
  assert.equal(await r.show.next('pedal'), 'done');
  assert.equal(r.show.sceneIndex, 1);
  r.close();
});

test('a restart inside the window restores PANIC: every wrist silent, nothing but silence loaded', async (t) => {
  const r = await rig(t, { state: { sceneIndex: 1, trims, masterDb: 0, panicked: true, savedAt: Date.now() - 5_000 } });
  assert.equal(r.show.panicked, true);
  assert.equal(r.show.sceneIndex, 1);
  for (const w of ['ZL', 'ZR', 'CL', 'CR'] as const) { assert.deepEqual(r.show.wrists[w].live, SILENCE); assert.equal(r.show.wrists[w].standby, null); }
  assert.deepEqual(r.loads().filter(([, p]) => p !== 'silence'), [], 'no sound loaded');
  for (const d of r.fake.devices.values()) assert.equal(d.name, 'silence');
  assert.ok(r.lines.some((l) => /restored in PANIC — resume from Admin/.test(l)));
  assert.equal(await r.show.next('pedal'), 'noop');
  await r.show.resume();
  await sleep(150);
  assert.ok(r.loads().some(([s, p]) => (s === 5 || s === 6) && p === 'COS_B'), 'resume brings scene B back');
  r.close();
});

test('the heartbeat keeps savedAt fresh through a long scene', async (t) => {
  const r = await rig(t, { heartbeatMs: 50 });
  await sleep(80);
  const a = r.store.load()?.savedAt;
  assert.ok(typeof a === 'number');
  await sleep(150);
  assert.ok(r.store.load()!.savedAt > a!, 'savedAt advanced with no change');
  r.close();
});

test('reconcile does nothing while the engine is offline', async (t) => {
  const r = await rig(t);
  await r.show.next('pedal'); await sleep(150);
  await r.fake.stop();
  await sleep(250);                 // > 3 polls of 50 ms → offline
  assert.equal(r.airkit.online, false);
  r.airkit.emit('seats', { [r.port(1)]: 'silence', [r.port(2)]: 'silence' });   // a booting engine's seats: drifted from the model
  r.show.reconcile({ [r.port(1)]: 'COS_B', [r.port(2)]: 'silence' });
  assert.deepEqual(r.lines.filter((l) => /reloading|giving up/.test(l)), []);
  r.close();
});

test('re-push over a healthy engine loads nothing whose seat already matches; levels and xfades still sent', async (t) => {
  const r = await rig(t);
  await r.show.next('pedal'); await sleep(300);   // → A, settled, B preloaded
  const m = r.mark();
  await r.show.pushAll();
  await sleep(100);
  assert.deepEqual(r.loads(m), [], 'no loadPersonality for matching seats');
  assert.ok(r.lines.some((l) => /slot 1 already on COS_A|slot 2 already on COS_A/.test(l)));
  assert.equal(r.sends('/airkit/cos/level', m).filter(([w]) => w !== 'audition').length, 4);
  assert.equal(r.sends('/airkit/cos/xfade', m).length, 4);
  assert.equal(r.sends('/airkit/cos/master', m).length, 1);
  assert.ok(r.sends('/airkit/cos/params', m).length >= 9);
  // a seat that drifted is still re-pushed
  const zlLive = r.port(1 + r.show.wrists.ZL.liveSlot);
  r.fake.devices.get(zlLive)!.name = 'silence';
  const m2 = r.mark();
  await r.show.pushAll();
  await sleep(100);
  assert.deepEqual(r.loads(m2), [[1 + r.show.wrists.ZL.liveSlot, 'COS_A']]);
  r.close();
});
