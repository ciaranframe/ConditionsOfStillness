import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { fakeAirkit } from './fake-airkit.ts';
import { startFakeSticks } from './fake-sticks.ts';
import { main } from '../src/main.ts';
import { Log } from '../src/log.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPO = new URL('../../', import.meta.url).pathname;

test('boots from the shipped files, forwards a mapped stick to both slots, reloads scenes on edit, assigns a stick from Admin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cos-main-'));
  mkdirSync(join(root, 'scenes')); mkdirSync(join(root, 'airkit', 'lists'), { recursive: true });
  cpSync(join(REPO, 'scenes'), join(root, 'scenes'), { recursive: true });
  cpSync(join(REPO, 'airkit', 'lists', 'list_conditions.sc'), join(root, 'airkit', 'lists', 'list_conditions.sc'));
  const fake = await fakeAirkit({ roster: ['silence', 'COS_Template', 'silence'], readyDelayMs: 10 });
  const quiet = new Log(500, Date.now, () => {});
  const r = await main({ repoRoot: root, scenesPath: join(root, 'scenes/conditions.yaml'), castPath: join(root, 'scenes/cast.yaml'), statePath: join(root, 'state.json'), airkitHost: '127.0.0.1', airkitPort: fake.port, sourcePort: 0, stickPort: 0, webPort: 0, publicDir: join(REPO, 'runner/public'), log: quiet });
  await sleep(300);
  assert.equal(r.show.sceneIndex, -1);
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: r.stickPort }, ids: ['7'], hz: 50 });
  await sleep(200);
  let view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
  assert.ok(view.heard.some((h: any) => h.id === '7' && h.wrist === null), 'unmapped stick heard');
  const ws = new WebSocket(`ws://127.0.0.1:${r.webPort}`);
  await new Promise((res) => ws.on('open', res));
  ws.send(JSON.stringify({ type: 'assignStick', wrist: 'CL', id: '7', label: 'B1' }));
  await sleep(500);
  assert.match(readFileSync(join(root, 'scenes/cast.yaml'), 'utf8'), /CL: \{ id: "?7"?, label: B1/);
  view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
  assert.equal(view.wrists.CL.state, 'SILENT');           // alive now, on silence in STANDBY
  assert.equal(view.wrists.CL.label, 'B1');
  const imu5 = fake.log.filter((m) => m.address === '/5/IMUFusedData').length, imu6 = fake.log.filter((m) => m.address === '/6/IMUFusedData').length;
  assert.ok(imu5 > 5 && imu6 > 5, 'forwarded to both CL slots');
  // a cast.yaml that is not YAML keeps the previous cast
  const castGood = readFileSync(join(root, 'scenes/cast.yaml'), 'utf8');
  writeFileSync(join(root, 'scenes/cast.yaml'), 'sticks: [\n');
  await sleep(600);
  view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
  assert.equal(view.wrists.CL.label, 'B1', 'previous cast kept');
  assert.match(view.castError ?? '', /yaml/);
  const imu5Before = fake.log.filter((m) => m.address === '/5/IMUFusedData').length;
  await sleep(200);
  assert.ok(fake.log.filter((m) => m.address === '/5/IMUFusedData').length > imu5Before + 3, 'stick still forwarded');
  writeFileSync(join(root, 'scenes/cast.yaml'), castGood);
  await sleep(600);
  view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
  assert.equal(view.castError, null);
  assert.equal(view.wrists.CL.label, 'B1');
  // an empty cast.yaml (a save truncated to zero bytes) is unusable too
  writeFileSync(join(root, 'scenes/cast.yaml'), '');
  await sleep(600);
  view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
  assert.equal(view.wrists.CL.label, 'B1', 'previous cast kept after an empty file');
  assert.match(view.castError ?? '', /yaml/);
  writeFileSync(join(root, 'scenes/cast.yaml'), castGood);
  await sleep(600);
  view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
  assert.equal(view.castError, null);
  // scenes edit: make scene A silence-only → after reload, the STANDBY preload of slot 2 is replaced by silence
  writeFileSync(join(root, 'scenes/conditions.yaml'), 'piece: T\nscenes:\n  - { id: A, name: Quiet, sounds: { ZL: silence } }\n');
  await sleep(600);
  assert.equal(r.show.scenes.length, 1);
  assert.equal(r.show.scenesError, null);
  writeFileSync(join(root, 'scenes/conditions.yaml'), 'scenes: [\n');
  await sleep(600);
  assert.equal(r.show.scenes.length, 1, 'old scenes kept');
  assert.match(r.show.scenesError ?? '', /yaml/);
  ws.close(); sticks.close(); await r.close(); fake.close();
});
