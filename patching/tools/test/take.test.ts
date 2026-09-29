// Take recorder tests (Review Focus 4): only the requested id is recorded, the header and rows
// are shaped right, and a stream that goes quiet still closes cleanly with the rows so far.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordTake } from '../src/take.ts';
import { startFakeSticks } from '../../../runner/test/fake-sticks.ts';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'take-record.ts');

function indexRowCols(indexText: string, label: string): string[] {
  const line = indexText.trim().split('\n').find((l) => l.includes(`| ${label} |`));
  assert.ok(line, `no INDEX.md row for ${label}:\n${indexText}`);
  return line!.split('|').slice(1, -1).map((s) => s.trim());
}

test('records only the requested id; header, rows and INDEX row are correct', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const handle = await recordTake({ port: 0, id: '3', label: 'seconds-take', seconds: 0.5, out });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: handle.port }, ids: ['3', '9'], hz: 50 });
  try {
    const result = await handle.done;
    assert.equal(result.reason, 'seconds');
    assert.equal(result.path, join(out, 'seconds-take.take.jsonl'));
    assert.ok(result.rows > 0, 'expected at least one row');

    const lines = readFileSync(result.path, 'utf8').trim().split('\n');
    const header = JSON.parse(lines[0]!);
    assert.equal(header.label, 'seconds-take');
    assert.equal(header.wrist, null);
    assert.equal(header.id, '3');
    assert.match(header.startedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ$/);
    assert.equal(header.hz, result.hz);
    assert.ok(Math.abs(header.hz - 50) <= 15, `hz measured as ${header.hz}, expected ~50`);

    const rows = lines.slice(1).map((l) => JSON.parse(l));
    assert.equal(rows.length, result.rows);
    assert.equal(rows[0].t, 0);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].t >= rows[i - 1].t, `t not monotonic at row ${i}`);
    for (const r of rows) {
      assert.equal(r.a.length, 3);
      assert.equal(r.q.length, 4);
      assert.ok([...r.a, ...r.q].every((n: number) => Number.isFinite(n)));
    }

    const cols = indexRowCols(readFileSync(join(out, 'INDEX.md'), 'utf8'), 'seconds-take');
    assert.deepEqual(cols.slice(0, 2), ['seconds-take', '3']);
    assert.match(cols[2]!, /^\d{4}-\d\d-\d\d$/);
    assert.ok(Math.abs(Number(cols[3]) - 0.5) < 0.35, `seconds column ${cols[3]}`);
    assert.equal(cols[4], '');
  } finally {
    sticks.close();
  }
});

test('a wrist recorded with --what carries the note through to the INDEX row', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const handle = await recordTake({ port: 0, id: '3', label: 'what-take', seconds: 0.2, out, what: 'piano scales slow' });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: handle.port }, ids: ['3'], hz: 50 });
  try {
    await handle.done;
    const cols = indexRowCols(readFileSync(join(out, 'INDEX.md'), 'utf8'), 'what-take');
    assert.equal(cols[4], 'piano scales slow');
  } finally {
    sticks.close();
  }
});

test('stop() ends the take cleanly with the rows recorded so far', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const handle = await recordTake({ port: 0, id: '3', label: 'stop-take', out });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: handle.port }, ids: ['3'], hz: 50 });
  try {
    await delay(200);
    handle.stop();
    const result = await handle.done;
    assert.equal(result.reason, 'stop');
    assert.ok(result.rows > 0);
  } finally {
    sticks.close();
  }
});

test('when the stream stops, the recorder closes after the (shortened) quiet timeout with the rows so far', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const handle = await recordTake({ port: 0, id: '3', label: 'stream-end-take', out, streamEndMs: 150 });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: handle.port }, ids: ['3'], hz: 50 });
  await delay(300);
  sticks.close();
  const result = await handle.done;
  assert.equal(result.reason, 'stream-ended');
  assert.ok(result.rows > 0, 'expected rows recorded before the stream stopped');

  const cols = indexRowCols(readFileSync(join(out, 'INDEX.md'), 'utf8'), 'stream-end-take');
  assert.match(cols[4]!, /\(stream ended\)/);
});

test('id 9 alone (never requested) yields zero rows: closes on seconds, writes neither the take nor an INDEX row', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const handle = await recordTake({ port: 0, id: '3', label: 'no-match-take', seconds: 0.3, out, warn: () => {} });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: handle.port }, ids: ['9'], hz: 50 });
  try {
    const result = await handle.done;
    assert.equal(result.reason, 'seconds');
    assert.equal(result.rows, 0);
    assert.equal(result.hz, 0);
    assert.equal(result.written, false);
    assert.equal(existsSync(join(out, 'no-match-take.take.jsonl')), false);
    assert.equal(existsSync(join(out, 'INDEX.md')), false);
  } finally {
    sticks.close();
  }
});

test('no packet within the warning window: warns once, naming the address, the port and how to repoint', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const warnings: string[] = [];
  const handle = await recordTake({ port: 0, id: '3', label: 'silent-take', seconds: 0.4, out, noPacketWarnMs: 100, warn: (m) => warnings.push(m) });
  const result = await handle.done;
  assert.equal(result.written, false);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], `waiting for /3/IMUFusedData on udp ${handle.port} — is the stick streaming here? (AirKit sticks: repoint with /Config/RequestStream, or stop the runner; the Glimmer C-stick build sends to a fixed address on 9000)`);
});

test('packets arriving before the warning window: no warning', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const warnings: string[] = [];
  const handle = await recordTake({ port: 0, id: '3', label: 'heard-take', seconds: 0.5, out, noPacketWarnMs: 300, warn: (m) => warnings.push(m) });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: handle.port }, ids: ['3'], hz: 50 });
  try {
    const result = await handle.done;
    assert.ok(result.written);
    assert.deepEqual(warnings, []);
  } finally {
    sticks.close();
  }
});

test('an existing label is refused; force replaces the take and keeps one INDEX row for it', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const first = await recordTake({ port: 0, id: '3', label: 'again', seconds: 0.3, out, what: 'first' });
  let sticks = startFakeSticks({ target: { host: '127.0.0.1', port: first.port }, ids: ['3'], hz: 50 });
  await first.done;
  sticks.close();
  const before = readFileSync(join(out, 'again.take.jsonl'), 'utf8');

  await assert.rejects(recordTake({ port: 0, id: '3', label: 'again', seconds: 0.3, out }), /already exists/);
  assert.equal(readFileSync(join(out, 'again.take.jsonl'), 'utf8'), before);

  const second = await recordTake({ port: 0, id: '3', label: 'again', seconds: 0.3, out, what: 'second', force: true });
  sticks = startFakeSticks({ target: { host: '127.0.0.1', port: second.port }, ids: ['3'], hz: 50 });
  try {
    const r = await second.done;
    assert.ok(r.written);
    assert.notEqual(readFileSync(join(out, 'again.take.jsonl'), 'utf8'), before);
    const rows = readFileSync(join(out, 'INDEX.md'), 'utf8').split('\n').filter((l) => l.startsWith('| again |'));
    assert.equal(rows.length, 1, rows.join('\n'));
    assert.match(rows[0]!, /\| second \|$/);
  } finally {
    sticks.close();
  }
});

test('labels outside [A-Za-z0-9_.-] are rejected before binding', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  for (const label of ['a|b', '../escape', 'with space', '', 'x/y']) {
    await assert.rejects(recordTake({ port: 0, id: '3', label, seconds: 0.1, out }), /label/, label);
  }
});

// --- CLI -------------------------------------------------------------------------------------

function runCli(args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('CLI: 0 rows exits 1 and writes nothing', () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const r = runCli(['nothing-heard', '--id', '3', '--port', '0', '--seconds', '0.3', '--out', out]);
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /no packets/);
  assert.equal(existsSync(join(out, 'nothing-heard.take.jsonl')), false);
  assert.equal(existsSync(join(out, 'INDEX.md')), false);
});

test('CLI: an existing label exits 1 unless --force; a bad label exits 2', () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  writeFileSync(join(out, 'taken.take.jsonl'), '{"label":"taken"}\n');
  const r = runCli(['taken', '--id', '3', '--port', '0', '--seconds', '0.2', '--out', out]);
  assert.equal(r.code, 1);
  assert.match(r.err, /already exists.*--force/);
  // --force gets past the check (then records nothing here: exit 1 for 0 rows, old file untouched)
  const forced = runCli(['taken', '--id', '3', '--port', '0', '--seconds', '0.2', '--out', out, '--force']);
  assert.equal(forced.code, 1);
  assert.match(forced.err, /no packets/);
  assert.equal(readFileSync(join(out, 'taken.take.jsonl'), 'utf8'), '{"label":"taken"}\n');
  assert.equal(runCli(['bad|label', '--id', '3', '--out', out]).code, 2);
});

// --- --wrist (through cast.yaml) ------------------------------------------------------------

function writeCast(out: string): string {
  const castPath = join(out, 'cast.yaml');
  writeFileSync(castPath, 'sticks:\n  ZL: { id: 3, label: A3 }\n  ZR: { id: null }\n');
  return castPath;
}

test('--wrist resolves the id through cast.yaml and records only the mapped stick', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const castPath = writeCast(out);
  const handle = await recordTake({ port: 0, wrist: 'ZL', label: 'wrist-take', seconds: 0.3, out, castPath });
  const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: handle.port }, ids: ['3', '9'], hz: 50 });
  try {
    const result = await handle.done;
    assert.ok(result.rows > 0, 'expected rows for the mapped stick (id 3)');
    const header = JSON.parse(readFileSync(result.path, 'utf8').split('\n')[0]!);
    assert.equal(header.wrist, 'ZL');
    assert.equal(header.id, '3');
    const cols = indexRowCols(readFileSync(join(out, 'INDEX.md'), 'utf8'), 'wrist-take');
    assert.equal(cols[1], 'ZL'); // the INDEX "wrist" column shows the wrist, not the raw id
  } finally {
    sticks.close();
  }
});

test('--wrist with no assigned stick id rejects with a clear error naming the wrist', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const castPath = writeCast(out);
  await assert.rejects(
    recordTake({ port: 0, wrist: 'ZR', label: 'no-id-take', out, castPath }),
    (err: unknown) => err instanceof Error && /ZR/.test(err.message) && /no stick id/.test(err.message),
  );
});

test('an unknown wrist key rejects with a clean Error, not a raw TypeError', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  const castPath = writeCast(out);
  await assert.rejects(
    recordTake({ port: 0, wrist: 'QQ' as unknown as 'ZL', label: 'bad-wrist-take', out, castPath }),
    (err: unknown) => err instanceof Error && !(err instanceof TypeError) && /QQ/.test(err.message),
  );
});

// --- bind failure ----------------------------------------------------------------------------

test('binding an already-used port rejects promptly instead of hanging', async () => {
  const blocker = createSocket('udp4');
  await new Promise<void>((resolve) => blocker.bind(0, resolve));
  const busyPort = (blocker.address() as { port: number }).port;
  const out = mkdtempSync(join(tmpdir(), 'cos-take-'));
  try {
    const start = Date.now();
    await assert.rejects(recordTake({ port: busyPort, id: '3', label: 'busy-port-take', out }));
    assert.ok(Date.now() - start < 1000, 'a bind failure should reject promptly, not hang');
  } finally {
    blocker.close();
  }
});
