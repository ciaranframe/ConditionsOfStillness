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
