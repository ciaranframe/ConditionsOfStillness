import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/airkit-rebase.sh');
const g = (dir: string, ...a: string[]) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });

function world() {
  const root = mkdtempSync(join(tmpdir(), 'rb-'));
  const upstream = join(root, 'upstream.git'); spawnSync('git', ['init', '-q', '--bare', '-b', 'AirConcert', upstream]);
  const mirror = join(root, 'mirror.git'); spawnSync('git', ['init', '-q', '--bare', '-b', 'AirConditions', mirror]);
  const seed = join(root, 'seed'); spawnSync('git', ['clone', '-q', upstream, seed]);
  g(seed, 'checkout', '-q', '-b', 'AirConcert');
  writeFileSync(join(seed, 'shared.txt'), 'v1\n'); g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'base'); g(seed, 'push', '-q', 'origin', 'AirConcert');
  const wt = join(root, 'airkit'); spawnSync('git', ['clone', '-q', '-b', 'AirConcert', upstream, wt]);
  g(wt, 'checkout', '-q', '-b', 'AirConditions');
  writeFileSync(join(wt, 'ours.txt'), 'cos\n'); g(wt, 'add', '.'); g(wt, 'commit', '-q', '-m', 'cos: ours');
  g(wt, 'remote', 'add', 'mirror', mirror); g(wt, 'push', '-q', '-u', 'mirror', 'AirConditions');
  return { root, upstream, mirror, seed, wt };
}
function run(wt: string, ...a: string[]) {
  const r = spawnSync('bash', [script, ...a], { env: { ...process.env, COS_AIRKIT_WORKTREE: wt }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('refuses a dirty worktree with exit 3', () => {
  const w = world();
  writeFileSync(join(w.wt, 'ours.txt'), 'edited\n');
  const r = run(w.wt);
  assert.equal(r.code, 3);
  assert.match(r.out, /dirty/);
});

test('rebases onto new upstream commits and force-pushes the mirror', () => {
  const w = world();
  writeFileSync(join(w.seed, 'shared.txt'), 'v2\n'); g(w.seed, 'commit', '-q', '-am', 'steph: v2'); g(w.seed, 'push', '-q', 'origin', 'AirConcert');
  const dry = run(w.wt, '--dry-run');
  assert.equal(dry.code, 0);
  assert.match(dry.out, /steph: v2/);
  assert.match(dry.out, /would run: git rebase origin\/AirConcert/);
  const r = run(w.wt);
  assert.equal(r.code, 0);
  assert.equal(readFileSync(join(w.wt, 'shared.txt'), 'utf8'), 'v2\n');
  const mirrorHead = g(w.mirror, 'rev-parse', 'AirConditions').stdout.trim();
  assert.equal(mirrorHead, g(w.wt, 'rev-parse', 'HEAD').stdout.trim());
  assert.match(r.out, /sha=/);
});

test('aborts on conflict with exit 2 and leaves the tree as it was', () => {
  const w = world();
  writeFileSync(join(w.wt, 'shared.txt'), 'cos edit\n'); g(w.wt, 'commit', '-q', '-am', 'cos: touch shared');
  const before = g(w.wt, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(join(w.seed, 'shared.txt'), 'steph edit\n'); g(w.seed, 'commit', '-q', '-am', 'steph: touch shared'); g(w.seed, 'push', '-q', 'origin', 'AirConcert');
  const r = run(w.wt);
  assert.equal(r.code, 2);
  assert.match(r.out, /shared\.txt/);
  assert.equal(g(w.wt, 'rev-parse', 'HEAD').stdout.trim(), before);
  assert.equal(g(w.wt, 'status', '--porcelain').stdout.trim(), '');
});
