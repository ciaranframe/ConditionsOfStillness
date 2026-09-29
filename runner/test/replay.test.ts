// Take replay: rows reach onImu on the take's own clock, a replayed wrist mutes its stick, the
// Admin command drives it end to end, and the parsers are strict about what they accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Replay, parseTakeIndex, parseTakeRows } from '../src/replay.ts';
import { parseCommand } from '../src/server.ts';
import { fakeAirkit } from './fake-airkit.ts';
import { startFakeSticks } from './fake-sticks.ts';
import { main } from '../src/main.ts';
import { Log } from '../src/log.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPO = new URL('../../', import.meta.url).pathname;

function writeTake(dir: string, label: string, n: number, stepMs = 10, what = 'x'): void {
  const header = { label, wrist: null, as: 'CF', id: 'X0', startedAt: '2026-09-29T10:00:00.000Z', hz: 100 };
  const rows = Array.from({ length: n }, (_, i) => ({ t: i * stepMs, a: [i, 0, -9.8], q: [0, 0, 0, 1] }));
  writeFileSync(join(dir, `${label}.take.jsonl`), [header, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(join(dir, 'INDEX.md'), `| label | wrist | date | seconds | what |\n|---|---|---|---|---|\n| ${label} | CF | 2026-09-29 | ${((n - 1) * stepMs / 1000).toFixed(1)} | ${what} |\n| ghost | CF | 2026-09-29 | 1.0 | file missing |\n`);
}

test('parseTakeRows keeps only well-formed rows; parseTakeIndex reads the table', () => {
  const rows = parseTakeRows('{"label":"h"}\n{"t":0,"a":[1,2,3],"q":[0,0,0,1]}\nnot json\n{"t":10,"a":[1,2],"q":[0,0,0,1]}\n{"t":20,"a":[1,2,3],"q":[0,0,0,"1"]}\n');
  assert.deepEqual(rows, [{ t: 0, floats: [1, 2, 3, 0, 0, 0, 1] }]);
  assert.deepEqual(parseTakeIndex('| label | wrist | date | seconds | what |\n|---|---|---|---|---|\n| a | CF | d | 1.0 | w |\n| bad label | CF | d | 1 | |\n'), [{ label: 'a', wrist: 'CF', date: 'd', seconds: '1.0', what: 'w' }]);
});

test('parseCommand accepts replay / replayStop and rejects bad labels and wrists', () => {
  assert.deepEqual(parseCommand({ type: 'replay', label: 'Still1', wrist: 'ZL' }), { type: 'replay', label: 'Still1', wrist: 'ZL', loop: false });
  assert.deepEqual(parseCommand({ type: 'replay', label: 'Still1', wrist: 'CR', loop: true, ackId: 3 }), { type: 'replay', label: 'Still1', wrist: 'CR', loop: true });
  assert.deepEqual(parseCommand({ type: 'replayStop' }), { type: 'replayStop' });
  assert.equal(typeof parseCommand({ type: 'replay', label: '../x', wrist: 'ZL' }), 'string');
  assert.equal(typeof parseCommand({ type: 'replay', label: 'ok', wrist: 'XX' }), 'string');
});

test('plays rows on the take clock, lists takes with existence, loops, stops, and reports state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-replay-'));
  writeTake(dir, 't1', 21, 10);   // 200 ms
  const got: Array<[string, number[]]> = [];
  const lines: string[] = [];
  const rp = new Replay({ takesDir: dir, onImu: (w, f) => got.push([w, f]), log: (l) => lines.push(l) });
  assert.deepEqual(rp.list().map((t) => [t.label, t.exists]), [['t1', true], ['ghost', false]]);
  assert.equal(rp.state(), null);
  assert.throws(() => rp.play('ghost', 'ZL'), /no take file/);
  assert.throws(() => rp.play('t1', 'XX' as never), /unknown wrist/);

  let changes = 0; rp.on('change', () => changes++);
  rp.play('t1', 'CR');
  assert.equal(rp.active('CR'), true); assert.equal(rp.active('CL'), false);
  const s0 = rp.state()!;
  assert.equal(s0.label, 't1'); assert.equal(s0.wrist, 'CR'); assert.equal(s0.rows, 21); assert.ok(Math.abs(s0.seconds - 0.2) < 1e-9);
  assert.equal(got.length, 1, 'row 0 goes out at once');
  assert.deepEqual(got[0], ['CR', [0, 0, -9.8, 0, 0, 0, 1]]);
  await sleep(100);
  assert.ok(got.length >= 8 && got.length <= 13, `after 100 ms ${got.length} rows`);
  await sleep(200);
  assert.equal(got.length, 21, 'every row once');
  assert.equal(rp.state(), null, 'finished → stopped');
  assert.equal(changes, 2);
  assert.match(lines.at(-1)!, /t1 on CR finished/);

  got.length = 0;
  rp.play('t1', 'ZL', true);
  await sleep(450);
  assert.ok(got.length >= 40, `looping: ${got.length} rows in 450 ms`);
  assert.equal(rp.state()!.loop, true);
  rp.play('t1', 'ZR');   // replacing a replay: only one at a time
  assert.equal(rp.active('ZL'), false); assert.equal(rp.active('ZR'), true);
  rp.stop();
  assert.equal(rp.state(), null);
  assert.match(lines.at(-1)!, /t1 on ZR stopped/);
  rp.stop();   // idempotent
  rp.dispose();
});

test('Admin replay command feeds the wrist\'s slots and mutes its real stick; the view shows it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cos-replay-main-'));
  mkdirSync(join(root, 'scenes')); mkdirSync(join(root, 'airkit', 'lists'), { recursive: true }); mkdirSync(join(root, 'takes'));
  cpSync(join(REPO, 'scenes'), join(root, 'scenes'), { recursive: true });
  cpSync(join(REPO, 'airkit', 'lists', 'list_conditions.sc'), join(root, 'airkit', 'lists', 'list_conditions.sc'));
  writeTake(join(root, 'takes'), 'wave', 301, 10, 'a wave');   // 3 s
  const fake = await fakeAirkit({ roster: ['silence', 'COS_Template', 'silence'], readyDelayMs: 10 });
  const quiet = new Log(500, Date.now, () => {});
  const r = await main({ repoRoot: root, scenesPath: join(root, 'scenes/conditions.yaml'), castPath: join(root, 'scenes/cast.yaml'), statePath: join(root, 'state.json'), airkitHost: '127.0.0.1', airkitPort: fake.port, sourcePort: 0, stickPort: 0, webPort: 0, publicDir: join(REPO, 'runner/public'), log: quiet });
  const ws = new WebSocket(`ws://127.0.0.1:${r.webPort}`);
  await new Promise((res) => ws.on('open', res));
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: r.stickPort }, ids: ['7'], hz: 50 });
  try {
    await sleep(300);
    ws.send(JSON.stringify({ type: 'assignStick', wrist: 'CL', id: '7', label: 'B1' }));
    await sleep(500);
    let view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
    assert.deepEqual(view.takes.map((t: any) => [t.label, t.exists]), [['wave', true], ['ghost', false]]);
    assert.equal(view.replay, null);
    assert.equal(view.wrists.ZL.alive, false, 'ZL has no stick');

    // replay into ZL (no stick): slots 1 and 2 hear the take's rows, ZL reads alive
    const before1 = fake.log.filter((m) => m.address === '/1/IMUFusedData').length;
    ws.send(JSON.stringify({ type: 'replay', label: 'wave', wrist: 'ZL' }));
    await sleep(400);
    view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
    assert.equal(view.replay.label, 'wave'); assert.equal(view.replay.wrist, 'ZL'); assert.ok(view.replay.elapsedSec > 0.2);
    assert.equal(view.wrists.ZL.alive, true); assert.equal(view.wrists.ZL.state, 'SILENT');
    assert.match(view.wrists.ZL.detail, /replay wave/);
    assert.equal(view.status.find((c: any) => c.key === 'STICKS').value, '2 / 4');
    const rows1 = fake.log.filter((m) => m.address === '/1/IMUFusedData').slice(before1);
    const rows2 = fake.log.filter((m) => m.address === '/2/IMUFusedData').length;
    assert.ok(rows1.length >= 25, `slot 1 got ${rows1.length} replay rows`);
    assert.ok(rows2 >= 25, `slot 2 got ${rows2} replay rows`);
    assert.ok(rows1.some((m) => Number(m.args[0]) > 5), 'the take\'s ramping a.x is what arrives');

    // replay into CL while its real stick streams: only the take's rows reach slots 5/6 meanwhile
    ws.send(JSON.stringify({ type: 'replay', label: 'wave', wrist: 'CL' }));
    await sleep(100);
    const mark = fake.log.length;
    await sleep(300);
    const cl = fake.log.slice(mark).filter((m) => m.address === '/5/IMUFusedData');
    assert.ok(cl.length >= 20, `slot 5 got ${cl.length} rows`);
    assert.ok(cl.every((m) => Number(m.args[0]) > 0), 'the fake stick\'s a.x = 0 rows are muted while replaying');
    view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
    assert.equal(view.replay.wrist, 'CL'); assert.equal(view.wrists.ZL.alive, false, 'ZL replay replaced');

    ws.send(JSON.stringify({ type: 'replayStop' }));
    await sleep(150);
    view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
    assert.equal(view.replay, null);
    const mark2 = fake.log.length;
    await sleep(200);
    assert.ok(fake.log.slice(mark2).some((m) => m.address === '/5/IMUFusedData' && Number(m.args[0]) === 0), 'the real stick is heard again');

    // a missing take is refused (logged), nothing plays
    ws.send(JSON.stringify({ type: 'replay', label: 'ghost', wrist: 'ZR' }));
    await sleep(150);
    view = await (await fetch(`http://127.0.0.1:${r.webPort}/api/view`)).json();
    assert.equal(view.replay, null);
  } finally {
    ws.close(); sticks.close(); await r.close(); fake.close();
  }
});
