# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Conditions of Stillness piece repo its AirKit branch and worktree, a private mirror, a lock file, a setup script that prepares a fresh Mac, a rebase helper, and the README, so the engine, runner and skill sub-projects have a place to land.

**Architecture:** The piece repo (this folder, already `git init`ed with one commit) owns everything but AirKit code. AirKit code lives on a new branch `AirConditions` of Ciaran's existing clone `~/AirKit`, mounted here as a git worktree at `airkit/` (gitignored). `airkit.lock` pins branch, sha and remotes. `setup.sh` is a thin shell wrapper over `scripts/setup.ts`, whose decisions are pure functions in `scripts/lib/env.ts` tested with `node --test`.

**Tech Stack:** git worktrees; bash; Node ≥ 22.18 running TypeScript natively (`node file.ts`, `node --test`); curl + unzip for sc3-plugins.

**Spec:** `docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md` (§4 Repo layout and git strategy, §9 Transport and setup).

## Global Constraints

- Never edit, commit, stash, rebase or force-push anything on `~/AirKit`'s `AirConcert` branch; `~/AirKit`'s working tree must be left exactly as found (clean, on `AirConcert`).
- On the `AirConditions` branch: additive only; commits prefixed `cos:`; never rebase or force-push to `origin` (`sohla/AirKit`); force-push only ever to the private `mirror` remote, and only from `scripts/airkit-rebase.sh` with `--force-with-lease`.
- `AirConditions` is created from `origin/AirConcert` at sha `3703cae70305cd05e3dfa25ce24bc3258896b3e5` (verified 2026-09-26).
- Private mirror: `git@github.com:ciaranframe/AirKit-conditions.git`, remote name `mirror`. `origin` stays `https://github.com/sohla/AirKit.git`.
- No symlink overlays anywhere (`~/Documents` is cloud-synced and mangles symlinks).
- `setup.sh --check` must never change anything on disk.
- SuperCollider minimum `3.13.0` at `/Applications/SuperCollider.app`; sc3-plugins `3.14.0` from `https://github.com/supercollider/sc3-plugins/releases/download/Version-3.14.0/sc3-plugins-3.14.0-macOS.zip` into `~/Library/Application Support/SuperCollider/Extensions/SC3plugins`, with every `._*` AppleDouble file removed.
- Node minimum `22.18.0`.
- Piece-repo commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Every file written by a tool is written to a temp path and renamed into place.

## Review Focus

1. `setup.sh` run on a Mac where `~/AirKit` exists but has uncommitted changes: must not touch it; must still add the worktree (a worktree add is safe with a dirty main tree) and say so. Test pinned in Task 3 (`decideAirkitAction` treats dirtiness as irrelevant) and Task 4 (integration `--check` output names the action).
2. `setup.sh` run twice: second run reports everything present and exits 0 with no changes. Test pinned in Task 4.
3. `~/AirKit` exists but the `AirConditions` branch does not (a second machine that has Steph's repo but not our branch): must fetch the branch from `mirror` and create the worktree from it, never from `origin`. Test pinned in Task 3.
4. sc3-plugins zip contains `._*` files (AppleDouble); leaving one behind breaks SuperCollider class compile. Test pinned in Task 4 (`stripAppleDouble` on a fixture tree).
5. `airkit.lock` sha does not match the worktree's HEAD (someone committed on the branch and forgot the lock): `--check` must warn, not fail, and print the command to update. Test pinned in Task 3 (`lockStatus`) and Task 4.

---

### Task 1: AirConditions branch, worktree and lock file

**Files:**
- Create: `airkit.lock`
- Create (outside repo): `~/AirKit` branch `AirConditions`; worktree at `airkit/` (gitignored)

**Interfaces:**
- Produces: `airkit.lock` in `key=value` lines: `branch`, `sha`, `upstream`, `mirror`. Read by `parseLock` in Task 3.

- [ ] **Step 1: Confirm `~/AirKit` is clean and where we expect**

Run:
```bash
git -C ~/AirKit status --porcelain | grep -v '.DS_Store' ; git -C ~/AirKit rev-parse --abbrev-ref HEAD; git -C ~/AirKit rev-parse origin/AirConcert
```
Expected: no porcelain lines, `AirConcert`, `3703cae70305cd05e3dfa25ce24bc3258896b3e5`. If the sha differs, STOP and report: Steph has pushed; the spec pins `3703cae` and the lock must record whatever sha the branch is actually created from.

- [ ] **Step 2: Create the branch and the worktree in one command**

Run from the piece repo root:
```bash
git -C ~/AirKit worktree add "$PWD/airkit" -b AirConditions origin/AirConcert
```
Expected: `Preparing worktree (new branch 'AirConditions')`, `HEAD is now at 3703cae ...`.

- [ ] **Step 3: Verify the worktree and that the main checkout is untouched**

Run:
```bash
git -C airkit rev-parse --abbrev-ref HEAD; git -C airkit rev-parse HEAD; git -C ~/AirKit rev-parse --abbrev-ref HEAD; git -C ~/AirKit worktree list; git status --short | grep airkit || echo "airkit ignored ok"
```
Expected: `AirConditions`, `3703cae…`, `AirConcert`, two worktree lines, `airkit ignored ok`.

- [ ] **Step 4: Write `airkit.lock`**

```
branch=AirConditions
sha=3703cae70305cd05e3dfa25ce24bc3258896b3e5
upstream=https://github.com/sohla/AirKit.git
mirror=git@github.com:ciaranframe/AirKit-conditions.git
```

- [ ] **Step 5: Commit**

```bash
git add airkit.lock
git commit -m "cos foundation: pin AirKit branch AirConditions in airkit.lock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Private mirror remote and first push

**Files:**
- Modify (outside repo): `~/AirKit/.git/config` gains remote `mirror`

**Interfaces:**
- Produces: remote `mirror` on `~/AirKit` (shared by the worktree) with `AirConditions` pushed; `git ls-remote mirror AirConditions` returns the lock sha.

- [ ] **Step 1: Add the remote**

```bash
git -C ~/AirKit remote add mirror git@github.com:ciaranframe/AirKit-conditions.git
git -C ~/AirKit remote -v
```
Expected: `origin` (https sohla) and `mirror` (ssh ciaranframe) listed.

- [ ] **Step 2: Check whether the private repo exists yet**

```bash
git -C ~/AirKit ls-remote mirror 2>&1 | head -3
```
If the output contains `Repository not found` or `Permission denied`: **STOP** and ask Ciaran to create an empty **private** repository named `AirKit-conditions` under `ciaranframe` on GitHub (no README, no .gitignore, no licence), then rerun this step. `gh` is not installed on this machine, so this is a browser action.

- [ ] **Step 3: Push the branch, tracking the mirror**

```bash
git -C airkit push -u mirror AirConditions
git -C ~/AirKit ls-remote mirror refs/heads/AirConditions
```
Expected: the second command prints `3703cae70305cd05e3dfa25ce24bc3258896b3e5	refs/heads/AirConditions`.

- [ ] **Step 4: Confirm `origin` was not pushed to**

```bash
git -C ~/AirKit ls-remote origin refs/heads/AirConditions
```
Expected: empty output (the branch does not exist upstream).

Nothing to commit in the piece repo for this task.

---

### Task 3: Pure setup decisions (`scripts/lib/env.ts`)

**Files:**
- Create: `package.json` (repo root)
- Create: `scripts/lib/env.ts`
- Test: `scripts/test/env.test.ts`

**Interfaces:**
- Produces (all exported from `scripts/lib/env.ts`):
  - `parseLock(text: string): Lock` where `type Lock = { branch: string; sha: string; upstream: string; mirror: string }`; throws `Error("airkit.lock: missing key <k>")` on a missing key; ignores blank lines and `#` comments.
  - `versionAtLeast(found: string, min: string): boolean` — dotted numeric compare, missing components are 0.
  - `decideAirkitAction(s: AirkitState): AirkitAction` where
    `type AirkitState = { worktreeExists: boolean; worktreeBranch: string | null; homeCloneExists: boolean; homeCloneHasBranch: boolean }` and
    `type AirkitAction = 'ok' | 'add-worktree' | 'fetch-mirror-then-add-worktree' | 'clone-mirror' | 'wrong-branch'`.
  - `lockStatus(lock: Lock, headSha: string | null): 'match' | 'drift' | 'unknown'`.
  - `isAppleDouble(relPath: string): boolean` — true when the basename starts with `._`.
  - `type Check = { name: string; ok: boolean; detail: string; fix?: string }` and `renderReport(checks: Check[]): string` — one line per check, `[ok]`/`[!!]` prefix, then `fix:` lines indented for failures, then a final line `all good` or `N item(s) need attention`.

- [ ] **Step 1: Create `package.json` at the repo root**

```json
{
  "name": "conditions-of-stillness",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "test": "node --test \"scripts/test/*.test.ts\"",
    "setup:check": "node scripts/setup.ts --check"
  }
}
```

- [ ] **Step 2: Write the failing tests**

`scripts/test/env.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLock, versionAtLeast, decideAirkitAction, lockStatus, isAppleDouble, renderReport,
} from '../lib/env.ts';

test('parseLock reads the four keys and ignores comments', () => {
  const lock = parseLock('# pinned\nbranch=AirConditions\nsha=abc\n\nupstream=u\nmirror=m\n');
  assert.deepEqual(lock, { branch: 'AirConditions', sha: 'abc', upstream: 'u', mirror: 'm' });
});

test('parseLock throws on a missing key', () => {
  assert.throws(() => parseLock('branch=x\nsha=y\nupstream=u\n'), /missing key mirror/);
});

test('versionAtLeast compares dotted versions numerically', () => {
  assert.equal(versionAtLeast('3.13.0', '3.13'), true);
  assert.equal(versionAtLeast('3.9.3', '3.13.0'), false);
  assert.equal(versionAtLeast('26.5.0', '22.18.0'), true);
  assert.equal(versionAtLeast('22.17.9', '22.18'), false);
});

test('decideAirkitAction: everything present on the right branch is ok', () => {
  assert.equal(decideAirkitAction({ worktreeExists: true, worktreeBranch: 'AirConditions', homeCloneExists: true, homeCloneHasBranch: true }), 'ok');
});

test('decideAirkitAction: worktree on another branch is wrong-branch', () => {
  assert.equal(decideAirkitAction({ worktreeExists: true, worktreeBranch: 'AirConcert', homeCloneExists: true, homeCloneHasBranch: true }), 'wrong-branch');
});

test('decideAirkitAction: home clone with the branch but no worktree adds the worktree (dirtiness irrelevant)', () => {
  assert.equal(decideAirkitAction({ worktreeExists: false, worktreeBranch: null, homeCloneExists: true, homeCloneHasBranch: true }), 'add-worktree');
});

test('decideAirkitAction: home clone without the branch fetches it from the mirror first, never origin', () => {
  assert.equal(decideAirkitAction({ worktreeExists: false, worktreeBranch: null, homeCloneExists: true, homeCloneHasBranch: false }), 'fetch-mirror-then-add-worktree');
});

test('decideAirkitAction: no home clone clones the mirror', () => {
  assert.equal(decideAirkitAction({ worktreeExists: false, worktreeBranch: null, homeCloneExists: false, homeCloneHasBranch: false }), 'clone-mirror');
});

test('lockStatus: match, drift, unknown', () => {
  const lock = { branch: 'b', sha: 'abc', upstream: 'u', mirror: 'm' };
  assert.equal(lockStatus(lock, 'abc'), 'match');
  assert.equal(lockStatus(lock, 'def'), 'drift');
  assert.equal(lockStatus(lock, null), 'unknown');
});

test('isAppleDouble matches ._ basenames only', () => {
  assert.equal(isAppleDouble('SC3plugins/._BhobUGens.sc'), true);
  assert.equal(isAppleDouble('SC3plugins/BhobUGens.sc'), false);
  assert.equal(isAppleDouble('._x/y.sc'), false);
});

test('renderReport lists checks and counts failures', () => {
  const out = renderReport([
    { name: 'node', ok: true, detail: '26.5.0' },
    { name: 'sc3-plugins', ok: false, detail: 'not installed', fix: './setup.sh' },
  ]);
  assert.match(out, /\[ok\] node: 26\.5\.0/);
  assert.match(out, /\[!!\] sc3-plugins: not installed\n {4}fix: \.\/setup\.sh/);
  assert.match(out, /1 item\(s\) need attention$/);
  assert.match(renderReport([{ name: 'a', ok: true, detail: '' }]), /all good$/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '.../scripts/lib/env.ts'`.

- [ ] **Step 4: Implement `scripts/lib/env.ts`**

```ts
// Pure decisions for setup.ts. No I/O here: everything is testable with plain values.

export type Lock = { branch: string; sha: string; upstream: string; mirror: string };

export function parseLock(text: string): Lock {
  const kv = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const need = (k: keyof Lock): string => {
    const v = kv.get(k);
    if (v === undefined || v === '') throw new Error(`airkit.lock: missing key ${k}`);
    return v;
  };
  return { branch: need('branch'), sha: need('sha'), upstream: need('upstream'), mirror: need('mirror') };
}

export function versionAtLeast(found: string, min: string): boolean {
  const a = found.split('.').map((x) => parseInt(x, 10) || 0);
  const b = min.split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export type AirkitState = {
  worktreeExists: boolean;
  worktreeBranch: string | null;
  homeCloneExists: boolean;
  homeCloneHasBranch: boolean;
};
export type AirkitAction = 'ok' | 'add-worktree' | 'fetch-mirror-then-add-worktree' | 'clone-mirror' | 'wrong-branch';

// The branch name is fixed by airkit.lock; callers pass the worktree's actual branch.
export function decideAirkitAction(s: AirkitState, branch = 'AirConditions'): AirkitAction {
  if (s.worktreeExists) return s.worktreeBranch === branch ? 'ok' : 'wrong-branch';
  if (!s.homeCloneExists) return 'clone-mirror';
  return s.homeCloneHasBranch ? 'add-worktree' : 'fetch-mirror-then-add-worktree';
}

export function lockStatus(lock: Lock, headSha: string | null): 'match' | 'drift' | 'unknown' {
  if (headSha === null) return 'unknown';
  return headSha === lock.sha ? 'match' : 'drift';
}

export function isAppleDouble(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? '';
  return base.startsWith('._');
}

export type Check = { name: string; ok: boolean; detail: string; fix?: string };

export function renderReport(checks: Check[]): string {
  const lines: string[] = [];
  let bad = 0;
  for (const c of checks) {
    lines.push(`${c.ok ? '[ok]' : '[!!]'} ${c.name}: ${c.detail}`);
    if (!c.ok) {
      bad++;
      if (c.fix) lines.push(`    fix: ${c.fix}`);
    }
  }
  lines.push(bad === 0 ? 'all good' : `${bad} item(s) need attention`);
  return lines.join('\n');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `pass 11`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/lib/env.ts scripts/test/env.test.ts
git commit -m "cos foundation: pure setup decisions with tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `setup.sh` and `scripts/setup.ts`

**Files:**
- Create: `setup.sh`
- Create: `scripts/setup.ts`
- Create: `scripts/lib/sc3plugins.ts`
- Test: `scripts/test/sc3plugins.test.ts`, `scripts/test/setup.test.ts`

**Interfaces:**
- Consumes: everything in `scripts/lib/env.ts` (Task 3); `airkit.lock` (Task 1).
- Produces:
  - `scripts/lib/sc3plugins.ts`: `stripAppleDouble(root: string): string[]` (deletes every `._*` file under `root`, returns the relative paths removed) and `pluginsPresent(extensionsDir: string): boolean` (true when `<extensionsDir>/SC3plugins` is a directory containing at least one `.sc` or `.scx` file at any depth).
  - `scripts/setup.ts` CLI: `node scripts/setup.ts [--check] [--yes]`. `--check` reports only, exit 0 when all ok, exit 1 otherwise. Without `--check` it performs fixes (sc3-plugins download and install, AirKit worktree/clone, `npm ci` in `runner/` and `patching/tools/` when a `package.json` exists there) after printing what it will do; `--yes` skips the confirmation prompt. Environment overrides for tests and odd machines: `COS_SC_APP` (default `/Applications/SuperCollider.app`), `COS_SC_EXTENSIONS` (default `~/Library/Application Support/SuperCollider/Extensions`), `COS_AIRKIT_HOME` (default `~/AirKit`), `COS_REPO_ROOT` (default: directory containing `airkit.lock`, found by walking up from `scripts/`).
  - Report check names, in order: `node`, `supercollider`, `sc3-plugins`, `ffmpeg`, `airkit-worktree`, `airkit-lock`, `runner-deps`, `tools-deps`, `samples`, `network`.

- [ ] **Step 1: Write the failing sc3plugins tests**

`scripts/test/sc3plugins.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripAppleDouble, pluginsPresent } from '../lib/sc3plugins.ts';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sc3-'));
  mkdirSync(join(root, 'SC3plugins', 'BhobUGens'), { recursive: true });
  writeFileSync(join(root, 'SC3plugins', 'BhobUGens', 'BMoog.sc'), '');
  writeFileSync(join(root, 'SC3plugins', 'BhobUGens', '._BMoog.sc'), '');
  writeFileSync(join(root, 'SC3plugins', '._DS', ), '');
  return root;
}

test('stripAppleDouble removes only ._ files and reports them', () => {
  const root = fixture();
  const removed = stripAppleDouble(root).sort();
  assert.deepEqual(removed, ['SC3plugins/._DS', 'SC3plugins/BhobUGens/._BMoog.sc']);
  assert.equal(existsSync(join(root, 'SC3plugins', 'BhobUGens', 'BMoog.sc')), true);
  assert.equal(existsSync(join(root, 'SC3plugins', 'BhobUGens', '._BMoog.sc')), false);
});

test('pluginsPresent needs an SC3plugins dir with class files', () => {
  const root = fixture();
  assert.equal(pluginsPresent(root), true);
  const empty = mkdtempSync(join(tmpdir(), 'sc3e-'));
  assert.equal(pluginsPresent(empty), false);
  mkdirSync(join(empty, 'SC3plugins'));
  assert.equal(pluginsPresent(empty), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/test/sc3plugins.test.ts`
Expected: FAIL, cannot find `../lib/sc3plugins.ts`.

- [ ] **Step 3: Implement `scripts/lib/sc3plugins.ts`**

```ts
import { readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isAppleDouble } from './env.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Delete every AppleDouble `._*` file under root; a single one breaks SuperCollider's class compile. */
export function stripAppleDouble(root: string): string[] {
  const removed: string[] = [];
  for (const p of walk(root)) {
    const rel = relative(root, p);
    if (isAppleDouble(rel)) { rmSync(p); removed.push(rel); }
  }
  return removed;
}

export function pluginsPresent(extensionsDir: string): boolean {
  const dir = join(extensionsDir, 'SC3plugins');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return walk(dir).some((p) => p.endsWith('.sc') || p.endsWith('.scx'));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test scripts/test/sc3plugins.test.ts`
Expected: `pass 2`.

- [ ] **Step 5: Write the failing setup integration tests**

`scripts/test/setup.test.ts` — runs the CLI in `--check` mode against a fake environment (no SuperCollider, no home clone) and against this machine's real paths, and asserts the report shape and idempotence of `--check`.
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
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
  const before = readdirSync(root);
  const { code, out } = run({ COS_REPO_ROOT: root, COS_SC_APP: join(root, 'nope.app'), COS_SC_EXTENSIONS: ext, COS_AIRKIT_HOME: join(root, 'no-airkit') });
  assert.equal(code, 1);
  assert.match(out, /\[!!\] supercollider: not found/);
  assert.match(out, /\[!!\] sc3-plugins: not installed/);
  assert.match(out, /\[!!\] airkit-worktree: .*clone-mirror/);
  assert.match(out, /airkit-lock: unknown/);
  assert.deepEqual(readdirSync(root), before);
  assert.deepEqual(readdirSync(ext), []);
});

test('--check reports add-worktree when the home clone has the branch but the worktree is missing, even with a dirty home tree', () => {
  const root = fakeRepo();
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
  assert.equal(g('status', '--porcelain').stdout.trim(), ' M f');
});

test('--check reports fetch-mirror-then-add-worktree when the home clone lacks the branch', () => {
  const root = fakeRepo();
  const home = join(root, 'AirKit');
  mkdirSync(home);
  const g = (...a: string[]) => spawnSync('git', ['-C', home, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'AirConcert');
  writeFileSync(join(home, 'f'), '1'); g('add', 'f'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
  const { out } = run({ COS_REPO_ROOT: root, COS_AIRKIT_HOME: home, COS_SC_APP: join(root, 'nope.app'), COS_SC_EXTENSIONS: root });
  assert.match(out, /airkit-worktree: .*fetch-mirror-then-add-worktree/);
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
  const wt = join(root, 'airkit');
  mkdirSync(wt);
  const g = (...a: string[]) => spawnSync('git', ['-C', wt, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'AirConditions');
  writeFileSync(join(wt, 'f'), '1'); g('add', 'f'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x');
  const { out } = run({ COS_REPO_ROOT: root, COS_AIRKIT_HOME: join(root, 'no-airkit'), COS_SC_APP: join(root, 'nope.app'), COS_SC_EXTENSIONS: root });
  assert.match(out, /\[ok\] airkit-lock: drift .*update with: git -C airkit rev-parse HEAD/);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `node --test scripts/test/setup.test.ts`
Expected: FAIL (setup.ts does not exist; every test's `run` fails).

- [ ] **Step 7: Implement `scripts/setup.ts`**

```ts
#!/usr/bin/env node
// Prepare a Mac for Conditions of Stillness. `--check` reports only. See spec §9.
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseLock, versionAtLeast, decideAirkitAction, lockStatus, renderReport, type Check, type Lock } from './lib/env.ts';
import { stripAppleDouble, pluginsPresent } from './lib/sc3plugins.ts';

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

function airkitState() {
  const worktreeExists = existsSync(join(WORKTREE, '.git'));
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
    const tmp = mkdtempSync(join(tmpdir(), 'sc3-'));
    const zip = join(tmp, 'sc3.zip');
    const dl = sh('curl', ['-fsSL', '-o', zip, PLUGINS_URL]);
    if (!dl.ok) throw new Error(`download failed: ${dl.out}`);
    const un = sh('unzip', ['-q', zip, '-d', tmp]);
    if (!un.ok) throw new Error(`unzip failed: ${un.out}`);
    // The zip unpacks to a single folder containing SC3plugins/; find it.
    const found = sh('find', [tmp, '-type', 'd', '-name', 'SC3plugins', '-maxdepth', '3']).out.split('\n')[0];
    if (!found) throw new Error('SC3plugins folder not found in the archive');
    mkdirSync(SC_EXT, { recursive: true });
    const mv = sh('mv', [found, join(SC_EXT, 'SC3plugins')]);
    if (!mv.ok) throw new Error(`move failed: ${mv.out}`);
    const removed = stripAppleDouble(join(SC_EXT, 'SC3plugins'));
    console.log(`  installed SC3plugins; removed ${removed.length} AppleDouble file(s). Recompile the class library (Cmd-Shift-L) in any open SuperCollider.`);
    rmSync(tmp, { recursive: true, force: true });
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
const head = existsSync(join(WORKTREE, '.git')) ? (git(WORKTREE, 'rev-parse', 'HEAD').out || null) : null;
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
```

- [ ] **Step 8: Write `setup.sh`**

```bash
#!/bin/bash
# Prepare this Mac for Conditions of Stillness. `./setup.sh --check` only reports.
# Everything else lives in scripts/setup.ts; this wrapper only guarantees Node is there.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 22.18 is required (https://nodejs.org). Install it, then rerun ./setup.sh" >&2
  exit 1
fi
exec node scripts/setup.ts "$@"
```
Then `chmod +x setup.sh`.

- [ ] **Step 9: Run the full test suite and a real `--check`**

Run: `npm test && ./setup.sh --check; echo "exit $?"`
Expected: all tests pass; the real check prints `[ok] node`, `[ok] supercollider: 3.13.0`, `[!!] sc3-plugins: not installed`, `[ok] ffmpeg`, `[ok] airkit-worktree: AirConditions …`, `[ok] airkit-lock: match 3703cae`, and `exit 1` because sc3-plugins are missing on this laptop.

- [ ] **Step 10: Install sc3-plugins for real on this machine**

Run: `./setup.sh --yes && ./setup.sh --check; echo "exit $?"`
Expected: the download and install lines, then a check with `[ok] sc3-plugins` and `exit 0`. Then verify the class library compiles with the plugins present:
```bash
/Applications/SuperCollider.app/Contents/MacOS/sclang -e '"BMoog present: %".format(\BMoog.asClass.notNil).postln; 0.exit' 2>&1 | grep -E "BMoog present|ERROR" | head
```
Expected: `BMoog present: true` and no `ERROR` line. If sclang hangs past 60 s, kill it and report; a `._` file left behind is the usual cause (look for `._` under Extensions).

- [ ] **Step 11: Commit**

```bash
git add setup.sh scripts/setup.ts scripts/lib/sc3plugins.ts scripts/test/sc3plugins.test.ts scripts/test/setup.test.ts
git commit -m "cos foundation: setup.sh prepares a Mac (SuperCollider, sc3-plugins, ffmpeg, AirKit worktree, deps)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `scripts/airkit-rebase.sh` — explicit rebase onto Steph's new commits

**Files:**
- Create: `scripts/airkit-rebase.sh`
- Test: `scripts/test/airkit-rebase.test.ts`

**Interfaces:**
- Produces: `scripts/airkit-rebase.sh [--dry-run]`. Fetches `origin`, shows the new `AirConcert` commits, rebases `AirConditions` (in `airkit/`) onto `origin/AirConcert`, and on success pushes to `mirror` with `--force-with-lease` and prints the line to paste into `airkit.lock`. On conflict: `git rebase --abort`, prints the conflicting files, exits 2. Refuses to run when `airkit/` is dirty (exit 3). `--dry-run` prints the commands and the incoming commit list without running the rebase. Environment: `COS_AIRKIT_WORKTREE` (default `airkit/` next to the script's repo root) for tests.

- [ ] **Step 1: Write the failing test**

`scripts/test/airkit-rebase.test.ts` builds a throwaway "upstream" repo, a "mirror" repo, a clone with the two branches, and checks the three exits: dirty (3), clean success (0, mirror updated), conflict (2, aborted, tree unchanged).
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test scripts/test/airkit-rebase.test.ts`
Expected: FAIL (script missing; `bash: .../airkit-rebase.sh: No such file`).

- [ ] **Step 3: Write `scripts/airkit-rebase.sh`**

```bash
#!/bin/bash
# Rebase our AirConditions branch onto Steph's latest AirConcert, by explicit choice only.
# Never touches origin (sohla/AirKit): the only push is --force-with-lease to the private mirror.
#   exit 0 ok · 2 conflict (aborted, tree untouched) · 3 dirty worktree · 1 other error
# COS_AIRKIT_WORKTREE overrides the worktree path (tests).
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WT="${COS_AIRKIT_WORKTREE:-$HERE/airkit}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

if [ -n "$(git -C "$WT" status --porcelain | grep -v '.DS_Store')" ]; then
  echo "airkit-rebase: worktree is dirty ($WT). Commit or stash first." >&2; exit 3
fi
BR="$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
[ "$BR" = "AirConditions" ] || { echo "airkit-rebase: expected branch AirConditions, on $BR" >&2; exit 1; }

git -C "$WT" fetch -q origin AirConcert || { echo "airkit-rebase: fetch failed" >&2; exit 1; }
echo "== incoming from origin/AirConcert =="
git -C "$WT" log --oneline --no-decorate "HEAD..origin/AirConcert" | sed 's/^/  /'
NEW=$(git -C "$WT" rev-list --count "HEAD..origin/AirConcert")
[ "$NEW" = "0" ] && { echo "already up to date"; exit 0; }

if [ "$DRY" = "1" ]; then
  echo "would run: git rebase origin/AirConcert"
  echo "would run: git push --force-with-lease mirror AirConditions"
  exit 0
fi

if ! git -C "$WT" rebase origin/AirConcert >/dev/null 2>&1; then
  echo "airkit-rebase: CONFLICT. Files:" >&2
  git -C "$WT" diff --name-only --diff-filter=U | sed 's/^/  /' >&2
  git -C "$WT" rebase --abort
  echo "Aborted; tree restored. Resolve by hand only by re-applying OUR commits on top of Steph's lines — never rewrite hers." >&2
  exit 2
fi
git -C "$WT" push --force-with-lease mirror AirConditions || { echo "airkit-rebase: mirror push failed (rebase kept)" >&2; exit 1; }
SHA="$(git -C "$WT" rev-parse HEAD)"
echo "rebased and mirrored. Update airkit.lock:"
echo "sha=$SHA"
```
Then `chmod +x scripts/airkit-rebase.sh`.

- [ ] **Step 4: Run to verify pass**

Run: `node --test scripts/test/airkit-rebase.test.ts`
Expected: `pass 3`.

- [ ] **Step 5: Dry-run against the real worktree**

Run: `scripts/airkit-rebase.sh --dry-run; echo "exit $?"`
Expected: `already up to date` and `exit 0` (or, if Steph has pushed since, the incoming list and the two `would run` lines). It must not rebase.

- [ ] **Step 6: Commit**

```bash
git add scripts/airkit-rebase.sh scripts/test/airkit-rebase.test.ts
git commit -m "cos foundation: airkit-rebase.sh rebases AirConditions onto AirConcert by explicit choice, mirror only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: README, context folder, takes index

**Files:**
- Create: `README.md`
- Create: `patching/context/README.md`
- Create: `takes/INDEX.md`
- Create: `airkit/README-AirConditions.md` (on the AirKit branch, committed there with a `cos:` prefix)

**Interfaces:**
- Produces: documentation only. `takes/INDEX.md` is the table `take-record.ts` (sub-project 4) appends to, with columns `label | wrist | date | seconds | what`.

- [ ] **Step 1: Write `README.md`**

```markdown
# Conditions of Stillness — AirStick system

A composed piece for two AirStick-wearing performers (Zubin, piano; Claire, bass drum; one stick
on each wrist) and a chamber ensemble. Scenes assign a sound to each wrist and crossfade on a
footswitch cue. Design: `docs/superpowers/specs/2026-09-26-conditions-of-stillness-architecture-design.md`.

## Layout
| Path | What |
|---|---|
| `airkit/` | git worktree of AirKit on branch `AirConditions` (gitignored; created by `setup.sh`) |
| `airkit.lock` | branch, sha, upstream and private mirror the piece was tested against |
| `runner/` | the show runner and its Perform and Admin pages (sub-project 3) |
| `scenes/` | `conditions.yaml` cue list, `cast.yaml` stick and pedal mapping (sub-project 3) |
| `patching/` | piece profile, context, notes, corpus index, tools (sub-project 4) |
| `samples/` | audio per patch, downloaded per `SHOPPING.md`; audio gitignored |
| `takes/` | recorded wrist takes for auditioning; audio gitignored, `INDEX.md` committed |
| `scores/`, `plugins/` | the Sibelius score and the PatchMarks plugin |
| `scripts/` | `setup.ts` (behind `setup.sh`), `airkit-rebase.sh`, tests |
| `brainstorms/` | session logs |

## Setup on a Mac
```
./setup.sh --check     # report only
./setup.sh             # install what is missing (SuperCollider must be installed by hand)
npm test
```
Prerequisites installed by hand: SuperCollider ≥ 3.13 (`/Applications/SuperCollider.app`),
Node ≥ 22.18, Homebrew `ffmpeg`. `setup.sh` installs sc3-plugins 3.14.0, prepares the AirKit
worktree (from `~/AirKit` when present, else from the private mirror), and installs Node deps.

## Working on the AirKit branch
- Work in `airkit/` (branch `AirConditions`); `~/AirKit` stays on `AirConcert`, untouched.
- Commits prefixed `cos:`; additive only; OSC changes update `airkit/code3.0/API.md` in the same commit.
- Push to the private mirror: `git -C airkit push mirror AirConditions`. Never push to `origin`
  unless offering the branch to Steph on purpose.
- Take in Steph's new commits: `scripts/airkit-rebase.sh --dry-run`, then without the flag; then
  update `sha=` in `airkit.lock`.

## Network at the venue
- Dedicated access point + router for the piece. Laptop on a fixed IP on that network.
- Each stick streams to the laptop's IP and sclang port (`/Config/RequestStream`, see
  `airkit/configureAirStickOSC.sc`).
- The iPad for the Admin page joins the same network; the runner prints the URLs.

## Running
`./run.sh` arrives with sub-project 2 (engine profile). Until then, nothing here makes sound.
```

- [ ] **Step 2: Write `patching/context/README.md`**

```markdown
# Piece context for patching

Ciaran puts here whatever the patch skill should read before researching any sound:

- `programme-note.md` — what the piece is about, in the composer's words.
- `scenes.md` — one paragraph per scene (id, name, what the ensemble is doing, what the
  electronics should do, the gesture Zubin and Claire will actually be making).
- Anything else: score excerpts as text, references to pieces or recordings, images described.

Every file in this folder is read in full by `/airkit-patch` at the start of every patch.
Keep it current: the notes here shape the research more than the brief does.
```

- [ ] **Step 3: Write `takes/INDEX.md`**

```markdown
# Recorded wrist takes

Raw OSC from one wrist, timestamped, replayable by `patching/tools/patch-audition.ts`.
Files are `takes/<label>.take.jsonl` (gitignored). `take-record.ts` appends a row here.

| label | wrist | date | seconds | what |
|---|---|---|---|---|
```

- [ ] **Step 4: Write `airkit/README-AirConditions.md` on the AirKit branch and commit it there**

```markdown
# AirConditions branch

Branch of AirKit for *Conditions of Stillness* (Ciaran, 2026). Created from `AirConcert` at
`3703cae`. Additions only, under `code3.0/conditions/`, `personalities/COS_*.sc`,
`lists/list_conditions.sc`, plus `[COS]` sections in `code3.0/API.md`. Two env-driven,
default-preserving edits to the shared controllers are documented there. Commits are prefixed
`cos:`. The piece repo that drives this branch lives outside AirKit; see its README.
```
```bash
git -C airkit add README-AirConditions.md
git -C airkit commit -m "cos: README for the AirConditions branch"
git -C airkit push mirror AirConditions
git -C airkit rev-parse HEAD
```
Expected: the push succeeds; note the new sha.

- [ ] **Step 5: Update `airkit.lock` with the new sha and confirm the check**

Edit `airkit.lock` line `sha=` to the sha printed above. Run `./setup.sh --check` and expect `[ok] airkit-lock: match <7 chars>` and exit 0.

- [ ] **Step 6: Commit**

```bash
git add README.md patching/context/README.md takes/INDEX.md airkit.lock
git commit -m "cos foundation: README, patching context folder, takes index; lock follows branch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (§4, §9):** piece repo (done before this plan) ✓; `AirConditions` from `origin/AirConcert` as a worktree (Task 1) ✓; private mirror, `origin` untouched (Task 2) ✓; `airkit.lock` (Tasks 1, 6) ✓; `setup.sh` checks SC ≥ 3.13, installs sc3-plugins with `._*` stripped, checks ffmpeg, `npm ci` where sub-projects exist, AirKit via worktree or mirror clone, samples manifest check, network checklist (Task 4) ✓; rebase helper (Task 5) ✓; README with network notes (Task 6) ✓. `run.sh` is deliberately deferred to sub-project 2, which creates the thing it runs; the README says so.

**Placeholders:** none; every step has its content.

**Type consistency:** `Lock`, `Check`, `AirkitState`, `AirkitAction` are defined once in Task 3 and used with the same names in Task 4. `stripAppleDouble`/`pluginsPresent` names match between Task 4's test and implementation. The `airkit-lock` check's `detail` strings in Task 4 (`match …`, `drift …update with: git -C airkit rev-parse HEAD`, `unknown …`) match the regexes in the Task 4 tests.

**Review Focus:** each of the five lines is pinned: (1) Task 3 `decideAirkitAction` dirtiness test + Task 4 dirty-home integration test; (2) Task 4 idempotence test; (3) Task 3 + Task 4 `fetch-mirror-then-add-worktree` tests; (4) Task 4 `stripAppleDouble` test; (5) Task 3 `lockStatus` + Task 4 drift test.
