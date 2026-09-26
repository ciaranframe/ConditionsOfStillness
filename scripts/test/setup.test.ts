import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const setup = resolve('scripts/setup.ts');

function run(env: Record<string, string>, args: string[] = ['--check']) {
  const r = spawnSync(process.execPath, [setup, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'cos-'));
  writeFileSync(join(root, 'airkit.lock'), 'branch=AirConditions\nsha=abc\nupstream=u\nmirror=m\n');
  return root;
}

test('--check on a bare machine names every missing piece and exits 1 without touching anything', () => {
  const root = fakeRepo();
  const ext = mkdtempSync(join(tmpdir(), 'ext-'));
  try {
    const before = readdirSync(root);
    const { code, out } = run({ COS_REPO_ROOT: root, COS_SC_APP: join(root, 'nope.app'), COS_SC_EXTENSIONS: ext, COS_AIRKIT_HOME: join(root, 'no-airkit') });
    assert.equal(code, 1);
    assert.match(out, /\[!!\] supercollider: not found/);
    assert.match(out, /\[!!\] sc3-plugins: not installed/);
    assert.match(out, /\[!!\] airkit-worktree: .*clone-mirror/);
    assert.match(out, /airkit-lock: unknown/);
    assert.deepEqual(readdirSync(root), before);
    assert.deepEqual(readdirSync(ext), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(ext, { recursive: true, force: true });
  }
});

test('--check reports add-worktree when the home clone has the branch but the worktree is missing, even with a dirty home tree', () => {
  const root = fakeRepo();
  try {
    const home = join(root, 'AirKit');
    mkdirSync(home);
    const g = (...a: string[]) => spawnSync('git', ['-C', home, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'AirConcert');
    writeFileSync(join(home, 'f'), '1');
    g('add', 'f'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
    g('branch', 'AirConditions');
    writeFileSync(join(home, 'f'), 'dirty');
    const { out } = run({ COS_REPO_ROOT: root, COS_AIRKIT_HOME: home, COS_SC_APP: join(root, 'nope.app'), COS_SC_EXTENSIONS: root });
    assert.match(out, /airkit-worktree: .*add-worktree/);
    assert.equal(g('status', '--porcelain').stdout.trimEnd(), ' M f');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--check reports fetch-mirror-then-add-worktree when the home clone lacks the branch', () => {
  const root = fakeRepo();
  try {
    const home = join(root, 'AirKit');
    mkdirSync(home);
    const g = (...a: string[]) => spawnSync('git', ['-C', home, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'AirConcert');
    writeFileSync(join(home, 'f'), '1'); g('add', 'f'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
    const { out } = run({ COS_REPO_ROOT: root, COS_AIRKIT_HOME: home, COS_SC_APP: join(root, 'nope.app'), COS_SC_EXTENSIONS: root });
    assert.match(out, /airkit-worktree: .*fetch-mirror-then-add-worktree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--check on the real repo reports airkit-worktree ok and the lock sha, and is idempotent', () => {
  const a = run({});
  const b = run({});
  assert.match(a.out, /\[ok\] airkit-worktree: AirConditions/);
  assert.match(a.out, /airkit-lock: (match|drift)/);
  assert.equal(a.out, b.out);
});

test('--check warns (not fails) on lock drift', () => {
  const root = fakeRepo();
  try {
    const wt = join(root, 'airkit');
    mkdirSync(wt);
    const g = (...a: string[]) => spawnSync('git', ['-C', wt, ...a], { encoding: 'utf8' });
    g('init', '-q', '-b', 'AirConditions');
    writeFileSync(join(wt, 'f'), '1'); g('add', 'f'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x');
    const { out } = run({ COS_REPO_ROOT: root, COS_AIRKIT_HOME: join(root, 'no-airkit'), COS_SC_APP: join(root, 'nope.app'), COS_SC_EXTENSIONS: root });
    assert.match(out, /\[ok\] airkit-lock: drift .*update with: git -C airkit rev-parse HEAD/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
