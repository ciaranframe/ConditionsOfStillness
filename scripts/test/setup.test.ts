import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
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
    // mirror=m in the fake lock is not a repo at all, so the honest reachability check fails.
    assert.match(out, /\[!!\] airkit-mirror:/);
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

test('--check on the real repo reports airkit-worktree ok and the lock sha, and is idempotent', (t) => {
  if (!existsSync(resolve('airkit/.git'))) {
    t.skip('airkit/ worktree not present in this checkout; run ./setup.sh first');
    return;
  }
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
    assert.match(out, /\[ok\] airkit-lock: drift .*git -C airkit rev-parse HEAD/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- I1: mirror clone/fetch remote naming, exercised end to end with local bare repos ------

/** A local bare repo with one commit on branch AirConditions, standing in for the private mirror. */
function buildLocalMirror(): { mirrorDir: string; sha: string } {
  const mirrorDir = mkdtempSync(join(tmpdir(), 'mirror-'));
  spawnSync('git', ['init', '-q', '--bare', mirrorDir]);
  const seed = mkdtempSync(join(tmpdir(), 'seed-'));
  const g = (...a: string[]) => spawnSync('git', ['-C', seed, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'AirConditions');
  writeFileSync(join(seed, 'f'), '1');
  g('add', 'f');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
  g('remote', 'add', 'origin', mirrorDir);
  g('push', '-q', 'origin', 'AirConditions');
  const sha = g('rev-parse', 'HEAD').stdout.trim();
  rmSync(seed, { recursive: true, force: true });
  return { mirrorDir, sha };
}

const FAKE_UPSTREAM = 'https://example.invalid/sohla/AirKit.git';

test('setup.ts --yes clones the mirror with remote "mirror" and adds "origin" for upstream (clone-mirror)', () => {
  const root = mkdtempSync(join(tmpdir(), 'cos-'));
  const { mirrorDir, sha } = buildLocalMirror();
  const ext = mkdtempSync(join(tmpdir(), 'ext-'));
  try {
    mkdirSync(join(ext, 'SC3plugins'), { recursive: true });
    writeFileSync(join(ext, 'SC3plugins', 'x.sc'), ''); // pre-seeded: skip the plugin-install fix
    writeFileSync(join(root, 'airkit.lock'), `branch=AirConditions\nsha=${sha}\nupstream=${FAKE_UPSTREAM}\nmirror=${mirrorDir}\n`);
    const { code, out } = run({
      COS_REPO_ROOT: root,
      COS_AIRKIT_HOME: join(root, 'no-airkit-home'), // does not exist -> action is clone-mirror
      COS_SC_APP: join(root, 'nope.app'), // does not exist -> supercollider reports [!!], fine
      COS_SC_EXTENSIONS: ext,
    }, ['--yes']);
    assert.equal(code, 1, out); // supercollider missing, by hand
    const airkit = join(root, 'airkit');
    assert.equal(existsSync(join(airkit, '.git')), true);
    const g = (...a: string[]) => spawnSync('git', ['-C', airkit, ...a], { encoding: 'utf8' });
    assert.equal(g('remote', 'get-url', 'mirror').stdout.trim(), mirrorDir);
    assert.equal(g('remote', 'get-url', 'origin').stdout.trim(), FAKE_UPSTREAM);
    assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), 'AirConditions');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(mirrorDir, { recursive: true, force: true });
    rmSync(ext, { recursive: true, force: true });
  }
});

test('setup.ts --yes fetches the mirror into ~/AirKit and adds the airkit worktree, leaving the home clone on its own branch (fetch-mirror-then-add-worktree)', () => {
  const root = mkdtempSync(join(tmpdir(), 'cos-'));
  const { mirrorDir, sha } = buildLocalMirror();
  const ext = mkdtempSync(join(tmpdir(), 'ext-'));
  const home = mkdtempSync(join(tmpdir(), 'airkit-home-'));
  try {
    mkdirSync(join(ext, 'SC3plugins'), { recursive: true });
    writeFileSync(join(ext, 'SC3plugins', 'x.sc'), '');
    writeFileSync(join(root, 'airkit.lock'), `branch=AirConditions\nsha=${sha}\nupstream=${FAKE_UPSTREAM}\nmirror=${mirrorDir}\n`);
    const gh = (...a: string[]) => spawnSync('git', ['-C', home, ...a], { encoding: 'utf8' });
    gh('init', '-q', '-b', 'AirConcert'); // home clone has AirConcert only, never AirConditions
    writeFileSync(join(home, 'g'), '1');
    gh('add', 'g');
    gh('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'concert-base');
    const { code, out } = run({
      COS_REPO_ROOT: root,
      COS_AIRKIT_HOME: home,
      COS_SC_APP: join(root, 'nope.app'),
      COS_SC_EXTENSIONS: ext,
    }, ['--yes']);
    assert.equal(code, 1, out); // supercollider missing, by hand
    const airkit = join(root, 'airkit');
    const ga = (...a: string[]) => spawnSync('git', ['-C', airkit, ...a], { encoding: 'utf8' });
    assert.equal(existsSync(join(airkit, '.git')), true);
    assert.equal(ga('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), 'AirConditions');
    assert.equal(gh('remote', 'get-url', 'mirror').stdout.trim(), mirrorDir);
    assert.equal(gh('rev-parse', '--verify', '--quiet', 'refs/heads/AirConditions').status, 0);
    assert.equal(gh('status', '--porcelain').stdout.trim(), '');
    assert.equal(gh('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim(), 'AirConcert');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(mirrorDir, { recursive: true, force: true });
    rmSync(ext, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
