#!/usr/bin/env node
// Prepare a Mac for Conditions of Stillness. `--check` reports only. See spec §9.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseLock, versionAtLeast, decideAirkitAction, lockStatus, renderReport, type Check, type Lock } from './lib/env.ts';
import { pluginsPresent, installSc3Plugins } from './lib/sc3plugins.ts';

const SC_MIN = '3.13.0';
const NODE_MIN = '22.18.0';
const PLUGINS_URL = 'https://github.com/supercollider/sc3-plugins/releases/download/Version-3.14.0/sc3-plugins-3.14.0-macOS.zip';

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const YES = args.has('--yes');

function findRepoRoot(): string {
  if (process.env.COS_REPO_ROOT) return resolve(process.env.COS_REPO_ROOT);
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'airkit.lock'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('airkit.lock not found above scripts/; set COS_REPO_ROOT');
}
const ROOT = findRepoRoot();
const SC_APP = process.env.COS_SC_APP ?? '/Applications/SuperCollider.app';
const SC_EXT = process.env.COS_SC_EXTENSIONS ?? join(homedir(), 'Library/Application Support/SuperCollider/Extensions');
const AIRKIT_HOME = process.env.COS_AIRKIT_HOME ?? join(homedir(), 'AirKit');
const WORKTREE = join(ROOT, 'airkit');

function sh(cmd: string, a: string[], cwd?: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, a, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout ?? '') + (r.stderr ?? '')).trim() };
}
function git(dir: string, ...a: string[]) { return sh('git', ['-C', dir, ...a]); }

function scVersion(): string | null {
  const plist = join(SC_APP, 'Contents/Info.plist');
  if (!existsSync(plist)) return null;
  const r = sh('defaults', ['read', plist, 'CFBundleShortVersionString']);
  return r.ok ? r.out : null;
}

// True when both paths exist and refer to the same on-disk file (by device+inode). Guards
// against macOS's case-insensitive-but-case-preserving default filesystem, where distinct-looking
// paths like <root>/airkit and <root>/AirKit can be the same directory.
function samePath(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

function airkitState() {
  const worktreeIsHomeClone = existsSync(AIRKIT_HOME) && existsSync(WORKTREE) && samePath(WORKTREE, AIRKIT_HOME);
  const worktreeExists = !worktreeIsHomeClone && existsSync(join(WORKTREE, '.git'));
  const worktreeBranch = worktreeExists ? (git(WORKTREE, 'rev-parse', '--abbrev-ref', 'HEAD').out || null) : null;
  const homeCloneExists = existsSync(join(AIRKIT_HOME, '.git'));
  const homeCloneHasBranch = homeCloneExists && git(AIRKIT_HOME, 'rev-parse', '--verify', '--quiet', 'refs/heads/AirConditions').ok;
  return { worktreeExists, worktreeBranch, homeCloneExists, homeCloneHasBranch };
}

const fixes: Array<{ name: string; run: () => void }> = [];
const checks: Check[] = [];
const lock: Lock = parseLock(readFileSync(join(ROOT, 'airkit.lock'), 'utf8'));

// node
checks.push({ name: 'node', ok: versionAtLeast(process.versions.node, NODE_MIN), detail: process.versions.node, fix: `install Node >= ${NODE_MIN} (https://nodejs.org)` });

// supercollider
const scv = scVersion();
checks.push(scv === null
  ? { name: 'supercollider', ok: false, detail: `not found at ${SC_APP}`, fix: 'install SuperCollider 3.13+ from https://supercollider.github.io/downloads' }
  : { name: 'supercollider', ok: versionAtLeast(scv, SC_MIN), detail: scv, fix: `upgrade to >= ${SC_MIN}` });

// sc3-plugins
if (pluginsPresent(SC_EXT)) {
  checks.push({ name: 'sc3-plugins', ok: true, detail: join(SC_EXT, 'SC3plugins') });
} else {
  checks.push({ name: 'sc3-plugins', ok: false, detail: 'not installed', fix: `./setup.sh installs 3.14.0 into ${SC_EXT}` });
  fixes.push({ name: 'install sc3-plugins 3.14.0', run: () => {
    installSc3Plugins({
      extensionsDir: SC_EXT,
      fetchArchive: (zip) => {
        const dl = sh('curl', ['-fsSL', '-o', zip, PLUGINS_URL]);
        if (!dl.ok) throw new Error(`download failed: ${dl.out}`);
      },
      log: console.log,
    });
  } });
}

// ffmpeg
const ff = sh('ffmpeg', ['-version']);
checks.push({ name: 'ffmpeg', ok: ff.ok, detail: ff.ok ? ff.out.split('\n')[0] : 'not found', fix: 'brew install ffmpeg' });

// airkit worktree
const st = airkitState();
const action = decideAirkitAction(st, lock.branch);
if (action === 'ok') {
  checks.push({ name: 'airkit-worktree', ok: true, detail: `${lock.branch} at ${WORKTREE}` });
} else if (action === 'wrong-branch') {
  checks.push({ name: 'airkit-worktree', ok: false, detail: `airkit/ is on ${st.worktreeBranch}, expected ${lock.branch}`, fix: `git -C airkit checkout ${lock.branch}` });
} else {
  checks.push({ name: 'airkit-worktree', ok: false, detail: `missing; planned action: ${action}`, fix: './setup.sh' });
  fixes.push({ name: `airkit: ${action}`, run: () => {
    if (action === 'clone-mirror') {
      const r = sh('git', ['clone', '--branch', lock.branch, lock.mirror, WORKTREE]);
      if (!r.ok) throw new Error(r.out);
      git(WORKTREE, 'remote', 'add', 'origin-upstream', lock.upstream);
      return;
    }
    if (action === 'fetch-mirror-then-add-worktree') {
      if (!git(AIRKIT_HOME, 'remote', 'get-url', 'mirror').ok) git(AIRKIT_HOME, 'remote', 'add', 'mirror', lock.mirror);
      const f = git(AIRKIT_HOME, 'fetch', 'mirror', `${lock.branch}:${lock.branch}`);
      if (!f.ok) throw new Error(f.out);
      git(AIRKIT_HOME, 'branch', '--set-upstream-to', `mirror/${lock.branch}`, lock.branch);
    }
    const w = git(AIRKIT_HOME, 'worktree', 'add', WORKTREE, lock.branch);
    if (!w.ok) throw new Error(w.out);
  } });
}

// airkit lock
const head = st.worktreeExists ? (git(WORKTREE, 'rev-parse', 'HEAD').out || null) : null;
const ls = lockStatus(lock, head);
checks.push({ name: 'airkit-lock', ok: true, detail: ls === 'match' ? `match ${lock.sha.slice(0, 7)}` : ls === 'drift' ? `drift (worktree ${head?.slice(0, 7)}, lock ${lock.sha.slice(0, 7)}); update with: git -C airkit rev-parse HEAD > then edit airkit.lock` : 'unknown (no worktree yet)' });

// npm deps in sub-projects that exist
for (const [name, dir] of [['runner-deps', 'runner'], ['tools-deps', 'patching/tools']] as const) {
  const pkg = join(ROOT, dir, 'package.json');
  if (!existsSync(pkg)) { checks.push({ name, ok: true, detail: `${dir}/ not present yet` }); continue; }
  const has = existsSync(join(ROOT, dir, 'node_modules'));
  checks.push({ name, ok: has, detail: has ? 'installed' : 'missing', fix: `npm ci in ${dir}/` });
  if (!has) fixes.push({ name: `npm ci in ${dir}`, run: () => { const r = sh('npm', ['ci'], join(ROOT, dir)); if (!r.ok) throw new Error(r.out); } });
}

// samples manifests
const samplesDir = join(ROOT, 'samples');
let missing: string[] = [];
if (existsSync(samplesDir)) {
  for (const patch of sh('ls', [samplesDir]).out.split('\n').filter(Boolean)) {
    const man = join(samplesDir, patch, 'manifest.json');
    if (!existsSync(man)) continue;
    const m = JSON.parse(readFileSync(man, 'utf8')) as Record<string, { file: string }>;
    for (const [slot, e] of Object.entries(m)) if (!existsSync(join(samplesDir, patch, e.file))) missing.push(`${patch}:${slot}`);
  }
}
checks.push({ name: 'samples', ok: missing.length === 0, detail: missing.length === 0 ? 'every manifest entry present' : `missing ${missing.join(', ')}`, fix: 'see samples/<Patch>/SHOPPING.md' });

// network (informational)
checks.push({ name: 'network', ok: true, detail: 'laptop on a fixed IP on the piece router; sticks stream to it; iPad on the same network (README.md)' });

console.log(renderReport(checks));
const failing = checks.filter((c) => !c.ok).length;

if (CHECK) process.exit(failing === 0 ? 0 : 1);

if (fixes.length === 0) { console.log('nothing to do'); process.exit(failing === 0 ? 0 : 1); }
console.log('\nwill now: ' + fixes.map((f) => f.name).join('; '));
if (!YES) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question('proceed? [y/N] ');
  rl.close();
  if (a.trim().toLowerCase() !== 'y') process.exit(1);
}
for (const f of fixes) { console.log(`\n== ${f.name}`); f.run(); }
console.log('\nre-run ./setup.sh --check to confirm.');
