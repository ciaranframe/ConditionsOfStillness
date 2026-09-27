import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { fakeAirkit } from './fake-airkit.ts';
import { AirkitLink, RESTPOSE } from '../src/airkit.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROSTER = ['silence', 'COS_Template', 'COS_A', 'silence'];

// Every pair is also closed by t.after, so a failing assertion cannot leave sockets open and hang the run.
async function pair(t: TestContext, opts: { pollMs?: number; readyDelayMs?: number } = {}) {
  const fake = await fakeAirkit({ roster: ROSTER, readyDelayMs: opts.readyDelayMs ?? 20 });
  const link = new AirkitLink({ host: '127.0.0.1', port: fake.port, sourcePort: 0, pollMs: opts.pollMs ?? 100, log: () => {} });
  await link.start();
  const close = () => { link.close(); fake.close(); };
  t.after(close);
  return { fake, link, close };
}

test('goes online on the first status reply, learns roster and seats, offline after 3 missed polls', async (t) => {
  const { fake, link, close } = await pair(t, { pollMs: 60 });
  const events: string[] = [];
  link.on('online', () => events.push('online')); link.on('offline', () => events.push('offline'));
  await sleep(150);
  assert.equal(link.online, true);
  assert.deepEqual(link.roster, ROSTER);
  await fake.stop();
  await sleep(60 * 3 + 150);
  assert.equal(link.online, false);
  assert.deepEqual(events, ['online', 'offline']);
  await fake.start();
  await sleep(200);
  assert.equal(link.online, true);
  assert.deepEqual(events, ['online', 'offline', 'online']);
  close();
});

test('restPose creates nine devices; ensureDevices confirms them; load refuses a missing device', async (t) => {
  const { fake, link, close } = await pair(t);
  await sleep(150);
  assert.equal(link.load(1, 'COS_A'), false);            // no device yet → refused, not sent
  assert.equal(fake.sent('/airkit/loadPersonality').length, 0);
  assert.equal(await link.ensureDevices(1000), true);
  assert.equal(fake.devices.size, 9);
  const src = link.portOf(1);
  assert.deepEqual([...fake.devices.keys()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => src + i));
  assert.equal(link.load(1, 'COS_A'), true);
  assert.equal(link.load(1, 'COS_Nope'), false);
  await sleep(50);                                       // let the UDP datagram land
  const l = fake.sent('/airkit/loadPersonality')[0]!;
  assert.deepEqual(l.args, [src, 2]);
  assert.equal(l.from, src);
  close();
});

test('waitReady resolves once the slot reports the patch ready; false on timeout', async (t) => {
  const { fake, link, close } = await pair(t, { readyDelayMs: 150 });
  await link.ensureDevices(1000);
  link.load(3, 'COS_Template');
  const t0 = Date.now();
  assert.equal(await link.waitReady(3, 'COS_Template', 1000), true);
  assert.ok(Date.now() - t0 >= 100);
  assert.equal(await link.waitReady(4, 'COS_Template', 250), false);
  close();
});

test('every [COS] send has the documented shape and types', async (t) => {
  const { fake, link, close } = await pair(t);
  await link.ensureDevices(1000);
  link.params(7, { register: 'low', rate: 2 }); link.params(8, {});
  link.partner(7, 5); link.partner(8, null);
  link.xfade('ZL', 1, 6); link.level('CR', 0.5, 0.1); link.level('audition', 1, 0.1); link.master(0.7, 0.2); link.audition('CL'); link.audition(null);
  const imuBefore = fake.sent('/2/IMUFusedData').length;  // ensureDevices' rest pose already sent some
  link.forwardImu(2, RESTPOSE); link.forwardAux(2, 'Battery', [3.9, 81]);
  await sleep(80);
  const a = (addr: string) => fake.sent(addr).map((m) => m.args);
  assert.deepEqual(a('/airkit/cos/params'), [[7, 'register', 'low', 'rate', 2], [8]]);
  assert.deepEqual(a('/airkit/cos/partner'), [[7, 5], [8, 0]]);
  assert.deepEqual(fake.wrists.ZL, { pos: 1, level: 1, fade: 6 });
  assert.deepEqual(a('/airkit/cos/level'), [['CR', 0.5, 0.1], ['audition', 1, 0.1]]);
  assert.deepEqual(a('/airkit/cos/master'), [[0.7, 0.2]]);
  assert.deepEqual(a('/airkit/cos/audition'), [['CL'], []]);
  const imu = fake.sent('/2/IMUFusedData'); assert.equal(imu.length, imuBefore + 1); assert.equal(imu.at(-1)!.from, link.portOf(1));
  assert.equal(fake.sent('/2/Battery').length, 1);
  link.panic();                                          // after the wrist assertion: panic zeroes every level
  await sleep(80);
  assert.equal(fake.panics, 1);
  assert.equal(fake.wrists.ZL.level, 0);
  close();
});

test('levels broadcast is parsed into per-wrist peak/rms and emitted', async (t) => {
  const { fake, link, close } = await pair(t);
  fake.levels = [0.5, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0.6, 0.3];
  await sleep(300);
  assert.deepEqual(link.levels!.ZL, [0.5, 0.2]);
  assert.deepEqual(link.levels!.master, [0.6, 0.3]);
  close();
});

test('fake: loadPersonality on a missing port is an error; readyOverride lands a different name', async (t) => {
  const { fake, link, close } = await pair(t);
  await link.ensureDevices(1000);
  const port = link.portOf(3);
  fake.readyOverride[port] = 'COS_Template';
  assert.equal(link.load(3, 'COS_A'), true);
  await sleep(80);
  assert.equal(fake.devices.get(port)!.name, 'COS_Template');
  assert.deepEqual(fake.errors, []);
  fake.devices.delete(port);                             // the engine would throw; the fake records it
  link.load(3, 'COS_A');
  await sleep(50);
  assert.deepEqual(fake.errors, [`loadPersonality: no device on port ${port}`]);
  close();
});
