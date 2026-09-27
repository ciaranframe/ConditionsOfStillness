import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import WebSocket from 'ws';
import { startServer, staticPath, type Command } from '../src/server.ts';
import { Log } from '../src/log.ts';

const rawStatus = (port: number, path: string) => new Promise<number>((resolve, reject) => {
  get({ host: '127.0.0.1', port, path }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on('error', reject);
});

test('serves pages and the view, pushes view+log over ws, dispatches commands with acks', async (t) => {
  const pub = mkdtempSync(join(tmpdir(), 'cos-pub-'));
  writeFileSync(join(pub, 'perform.html'), '<h1>perform</h1>'); writeFileSync(join(pub, 'admin.html'), '<h1>admin</h1>');
  mkdirSync(join(pub, 'js')); writeFileSync(join(pub, 'js', 'x.js'), 'export const x = 1;');
  const log = new Log(10, Date.now, () => {});
  const got: Command[] = [];
  const view = { t: 1, standby: true } as never;
  const srv = await startServer({ port: 0, publicDir: pub, view: () => view, log, onCommand: async (c) => { got.push(c); if (c.type === 'jump' && c.index > 9) throw new Error('no such scene'); }, broadcastMs: 50 });
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  const root = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/perform');
  assert.match(await (await fetch(`${base}/perform`)).text(), /perform/);
  assert.match(await (await fetch(`${base}/admin`)).text(), /admin/);
  assert.equal((await fetch(`${base}/js/x.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`${base}/../etc/passwd`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)).status, 404);
  assert.equal(await rawStatus(srv.port, '/../../../../etc/passwd'), 404);   // not normalised by the client
  assert.equal(await rawStatus(srv.port, '/%E0%A4%A'), 404);                  // malformed escape
  assert.equal((await fetch(`${base}/js`)).status, 404);                      // a directory
  const api = await fetch(`${base}/api/view`);
  assert.match(api.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await api.json(), { t: 1, standby: true });
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
  const msgs: any[] = [];
  await new Promise<void>((r) => { ws.on('message', (d) => { msgs.push(JSON.parse(String(d))); if (msgs.length >= 2) r(); }); });
  assert.deepEqual(msgs.map((m) => m.type).sort(), ['log', 'view']);
  log.line('hello');
  ws.send(JSON.stringify({ type: 'cue', action: 'next' }));
  ws.send(JSON.stringify({ type: 'jump', index: 42 }));
  ws.send('not json');
  ws.send(JSON.stringify({ type: 'explode' }));
  ws.send(JSON.stringify({ type: 'trim', wrist: 'XX', db: 1 }));
  ws.send(JSON.stringify({ type: 'audition', wrist: 'CL', patch: null }));
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(msgs.some((m) => m.type === 'log' && m.lines.some((l: any) => l.msg === 'hello')));
  const acks = msgs.filter((m) => m.type === 'ack');
  assert.deepEqual(acks.map((a) => a.ok), [true, false, false, false, false, true]);
  assert.match(acks[1].error, /no such scene/);
  assert.match(acks[3].error, /unknown/);
  assert.deepEqual(got, [{ type: 'cue', action: 'next' }, { type: 'jump', index: 42 }, { type: 'audition', wrist: 'CL', patch: null }]);
  assert.ok(msgs.filter((m) => m.type === 'view').length >= 2, 'periodic view broadcast');
  const before = msgs.filter((m) => m.type === 'view').length;
  srv.broadcast();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(msgs.filter((m) => m.type === 'view').length > before, 'broadcast() pushes a view');
  const closed = new Promise((r) => ws.on('close', r));
  srv.close();
  await closed;
});

test('staticPath keeps every request inside publicDir', () => {
  const pub = '/srv/public';
  assert.equal(staticPath(pub, '/js/x.js'), '/srv/public/js/x.js');
  // '..' is resolved against the root first, so it can only ever land back inside publicDir
  assert.equal(staticPath(pub, '/../etc/passwd'), '/srv/public/etc/passwd');
  assert.equal(staticPath(pub, '/%2e%2e/%2e%2e/etc/passwd'), '/srv/public/etc/passwd');
  assert.equal(staticPath(pub, '/..%2f..%2f..%2fetc/passwd'), '/srv/public/etc/passwd');
  assert.equal(staticPath(pub, '/..%5c..%5cetc'), '/srv/public/..\\..\\etc');   // a backslash is a filename character on POSIX
  assert.equal(staticPath(pub, '/../public-evil/x'), '/srv/public/public-evil/x');
  assert.equal(staticPath(pub, '/%zz'), null);       // malformed escape
  assert.equal(staticPath(pub, '/a%00b'), null);     // NUL byte
});

test('every command variant is accepted and malformed fields are refused', async (t) => {
  const pub = mkdtempSync(join(tmpdir(), 'cos-pub-'));
  const got: Command[] = [];
  const srv = await startServer({ port: 0, publicDir: pub, view: () => ({}) as never, log: new Log(10, Date.now, () => {}), onCommand: (c) => { got.push(c); } });
  t.after(() => srv.close());
  const ok: Command[] = [
    { type: 'cue', action: 'back' }, { type: 'jump', index: 0 }, { type: 'trim', wrist: 'ZL', db: -3 }, { type: 'master', db: 2 },
    { type: 'panic' }, { type: 'resume' }, { type: 'audition', wrist: 'ZR', patch: 'COS_A' }, { type: 'reload', wrist: 'CR' },
    { type: 'assignStick', wrist: 'CL', id: '7', label: 'B1' }, { type: 'assignStick', wrist: 'CL', id: null },
  ];
  const bad = [
    { type: 'cue', action: 'sideways' }, { type: 'jump', index: 1.5 }, { type: 'jump', index: '2' }, { type: 'trim', wrist: 'ZL', db: 'loud' },
    { type: 'master' }, { type: 'audition', wrist: 'ZR' }, { type: 'reload' }, { type: 'assignStick', wrist: 'CL', id: 7 }, [1, 2], null,
  ];
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}`);
  const acks: any[] = [];
  ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type === 'ack') acks.push(m); });
  await new Promise((r) => ws.on('open', r));
  for (const c of [...ok, ...bad]) ws.send(JSON.stringify(c));
  for (let i = 0; i < 50 && acks.length < ok.length + bad.length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(acks.map((a) => a.ok), [...ok.map(() => true), ...bad.map(() => false)]);
  assert.deepEqual(got, ok);
  ws.close();
});
