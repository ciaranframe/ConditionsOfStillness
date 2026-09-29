// Take page tests: the desk hears sticks, records a take through the same writer as the CLI
// (file + INDEX row, filed as `CF` or a wrist), refuses bad requests, and reads PLAN.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseIndex, parsePlan, startTakePage } from '../src/take-page.ts';
import { startFakeSticks } from '../../../runner/test/fake-sticks.ts';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function post(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

test('parsePlan reads | label | what | rows and skips header, separator and bad labels', () => {
  const plan = parsePlan(`# Planned takes\n\n| label | what |\n|---|---|\n| A-still | hands on the keys |\n| bad label | spaces |\n|B-sway|sway slowly|\n`);
  assert.deepEqual(plan, [{ label: 'A-still', what: 'hands on the keys' }, { label: 'B-sway', what: 'sway slowly' }]);
  assert.deepEqual(parsePlan(''), []);
});

test('parseIndex reads the five-column INDEX.md table', () => {
  const rows = parseIndex(`# x\n\n| label | wrist | date | seconds | what |\n|---|---|---|---|---|\n| t1 | CF | 2026-09-29 | 12.3 | sway |\n`);
  assert.deepEqual(rows, [{ label: 't1', wrist: 'CF', date: '2026-09-29', seconds: '12.3', what: 'sway' }]);
});

test('hears sticks, records a take filed as CF through the API, and lists it', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-page-'));
  writeFileSync(join(out, 'PLAN.md'), '| label | what |\n|---|---|\n| p1 | first |\n| p2 | second |\n');
  const page = await startTakePage({ udpPort: 0, webPort: 0, out, log: () => {} });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: page.udpPort }, ids: ['X0'], hz: 50 });
  const base = `http://127.0.0.1:${page.webPort}`;
  try {
    await delay(300);
    const s0 = await (await fetch(`${base}/api/state`)).json();
    assert.equal(s0.as, 'CF');
    assert.equal(s0.heard.length, 1);
    assert.equal(s0.heard[0].id, 'X0');
    assert.equal(s0.heard[0].alive, true);
    assert.ok(s0.heard[0].rateHz > 10, `rate ${s0.heard[0].rateHz}`);
    assert.ok(Math.abs(s0.heard[0].mag - 9.8) < 0.1, `mag ${s0.heard[0].mag}`);
    assert.deepEqual(s0.plan, [{ label: 'p1', what: 'first', done: false }, { label: 'p2', what: 'second', done: false }]);
    assert.equal(s0.recording, null);

    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<title>Conditions — Takes<\/title>/);

    const r1 = await post(`${base}/api/record`, { label: 'p1', what: 'first', id: 'X0' });
    assert.equal(r1.status, 200, JSON.stringify(r1.json));
    assert.equal(r1.json.recording.label, 'p1');
    const r2 = await post(`${base}/api/record`, { label: 'p2', id: 'X0' });
    assert.equal(r2.status, 400);
    assert.match(r2.json.error, /already recording p1/);
    await delay(300);
    const mid = await (await fetch(`${base}/api/state`)).json();
    assert.ok(mid.recording.rows > 5, `rows ${mid.recording.rows}`);
    assert.equal(mid.recording.as, 'CF');

    const stopped = await post(`${base}/api/stop`, {});
    assert.equal(stopped.status, 200);
    assert.equal(stopped.json.result.written, true);
    assert.equal(stopped.json.result.reason, 'stop');
    assert.ok(existsSync(join(out, 'p1.take.jsonl')));
    const header = JSON.parse(readFileSync(join(out, 'p1.take.jsonl'), 'utf8').split('\n')[0]!);
    assert.equal(header.as, 'CF');
    assert.equal(header.wrist, null);
    assert.equal(header.id, 'X0');

    const s1 = await (await fetch(`${base}/api/state`)).json();
    assert.equal(s1.recording, null);
    assert.equal(s1.last.label, 'p1');
    assert.deepEqual(s1.plan.map((p: any) => p.done), [true, false]);
    assert.equal(s1.takes.length, 1);
    assert.deepEqual([s1.takes[0].label, s1.takes[0].wrist, s1.takes[0].what], ['p1', 'CF', 'first']);

    // same label again: refused without force, replaced with it
    const r3 = await post(`${base}/api/record`, { label: 'p1', id: 'X0' });
    assert.equal(r3.status, 400);
    assert.match(r3.json.error, /already exists/);
    const r4 = await post(`${base}/api/record`, { label: 'p1', id: 'X0', force: true, wrist: 'ZL' });
    assert.equal(r4.status, 200, JSON.stringify(r4.json));
    await delay(150);
    await post(`${base}/api/stop`, {});
    const s2 = await (await fetch(`${base}/api/state`)).json();
    assert.equal(s2.takes.length, 1);
    assert.equal(s2.takes[0].wrist, 'ZL');

    // stop with nothing live is a no-op
    const r5 = await post(`${base}/api/stop`, {});
    assert.equal(r5.json.result, null);
  } finally {
    sticks.close();
    await page.close();
  }
});

test('bad requests: label, id, wrist; a take with no packets writes nothing', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-page-'));
  const page = await startTakePage({ udpPort: 0, webPort: 0, out, log: () => {} });
  const base = `http://127.0.0.1:${page.webPort}`;
  try {
    assert.equal((await post(`${base}/api/record`, { label: 'has space', id: 'X0' })).status, 400);
    assert.equal((await post(`${base}/api/record`, { label: 'ok', id: '' })).status, 400);
    assert.equal((await post(`${base}/api/record`, { label: 'ok', id: 'X0', wrist: 'XX' })).status, 400);
    assert.equal((await post(`${base}/api/record`, { label: 'silent', id: 'X0' })).status, 200);
    const stopped = await post(`${base}/api/stop`, {});
    assert.equal(stopped.json.result.written, false);
    assert.equal(existsSync(join(out, 'silent.take.jsonl')), false);
    assert.equal(existsSync(join(out, 'INDEX.md')), false);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  } finally {
    await page.close();
  }
});

test('close() ends a live take cleanly and writes it', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-page-'));
  const page = await startTakePage({ udpPort: 0, webPort: 0, out, log: () => {} });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: page.udpPort }, ids: ['X0'], hz: 50 });
  try {
    page.record({ label: 'closing', id: 'X0' });
    await delay(200);
  } finally {
    await page.close();
    sticks.close();
  }
  assert.ok(existsSync(join(out, 'closing.take.jsonl')));
});
