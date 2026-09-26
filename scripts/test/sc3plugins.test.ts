import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stripAppleDouble, pluginsPresent, installSc3Plugins } from '../lib/sc3plugins.ts';

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
  try {
    const removed = stripAppleDouble(root).sort();
    assert.deepEqual(removed, ['SC3plugins/._DS', 'SC3plugins/BhobUGens/._BMoog.sc']);
    assert.equal(existsSync(join(root, 'SC3plugins', 'BhobUGens', 'BMoog.sc')), true);
    assert.equal(existsSync(join(root, 'SC3plugins', 'BhobUGens', '._BMoog.sc')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pluginsPresent needs an SC3plugins dir with class files', () => {
  const root = fixture();
  const empty = mkdtempSync(join(tmpdir(), 'sc3e-'));
  try {
    assert.equal(pluginsPresent(root), true);
    assert.equal(pluginsPresent(empty), false);
    mkdirSync(join(empty, 'SC3plugins'));
    assert.equal(pluginsPresent(empty), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

// --- installSc3Plugins -------------------------------------------------

/** Builds a local sc3-plugins-shaped zip (pkg/SC3plugins/...) with AppleDouble cruft baked in. */
function buildFixtureZip(): { work: string; zipPath: string } {
  const work = mkdtempSync(join(tmpdir(), 'sc3fix-'));
  mkdirSync(join(work, 'pkg', 'SC3plugins', 'BhobUGens'), { recursive: true });
  writeFileSync(join(work, 'pkg', 'SC3plugins', 'BhobUGens', 'BMoog.sc'), '');
  writeFileSync(join(work, 'pkg', 'SC3plugins', 'BhobUGens', '._BMoog.sc'), '');
  writeFileSync(join(work, 'pkg', 'SC3plugins', '._junk'), '');
  const zipPath = join(work, 'fixture.zip');
  const r = spawnSync('zip', ['-qr', zipPath, 'pkg'], { cwd: work });
  assert.equal(r.status, 0, `zip failed: ${r.stderr?.toString()}`);
  return { work, zipPath };
}

function findAll(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    out.push(p);
    if (e.isDirectory()) findAll(p, out);
  }
  return out;
}

test('installSc3Plugins builds clean in a temp dir, then renames into a fresh extensionsDir', () => {
  const { work, zipPath } = buildFixtureZip();
  const extensionsDir = mkdtempSync(join(tmpdir(), 'sc3ext-'));
  const tmpBefore = new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('sc3-')));
  try {
    const result = installSc3Plugins({
      extensionsDir,
      fetchArchive: (dest) => copyFileSync(zipPath, dest),
      log: () => {},
    });
    assert.equal(result.movedAside, null);
    assert.equal(result.installed, join(extensionsDir, 'SC3plugins'));
    assert.equal(existsSync(join(extensionsDir, 'SC3plugins', 'BhobUGens', 'BMoog.sc')), true);
    // No nesting: SC3plugins/SC3plugins would indicate the old non-atomic `mv` bug.
    assert.equal(existsSync(join(extensionsDir, 'SC3plugins', 'SC3plugins')), false);
    const leftoverAppleDouble = findAll(extensionsDir).some((p) => p.split('/').pop()?.startsWith('._'));
    assert.equal(leftoverAppleDouble, false);
    const tmpAfter = readdirSync(tmpdir()).filter((n) => n.startsWith('sc3-') && !tmpBefore.has(n));
    assert.deepEqual(tmpAfter, []);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(extensionsDir, { recursive: true, force: true });
  }
});

test('installSc3Plugins moves a stale SC3plugins aside instead of deleting it', () => {
  const { work, zipPath } = buildFixtureZip();
  const extensionsDir = mkdtempSync(join(tmpdir(), 'sc3ext-'));
  mkdirSync(join(extensionsDir, 'SC3plugins', 'OldStuff'), { recursive: true });
  writeFileSync(join(extensionsDir, 'SC3plugins', 'OldStuff', 'Old.sc'), '');
  let movedAsidePath: string | null = null;
  try {
    const result = installSc3Plugins({
      extensionsDir,
      fetchArchive: (dest) => copyFileSync(zipPath, dest),
      log: () => {},
    });
    movedAsidePath = result.movedAside;
    assert.equal(existsSync(join(extensionsDir, 'SC3plugins', 'SC3plugins')), false);
    assert.match(result.movedAside ?? '', /SC3plugins\.replaced-/);
    assert.equal(existsSync(result.movedAside as string), true);
    assert.equal(existsSync(join(result.movedAside as string, 'OldStuff', 'Old.sc')), true);
    assert.equal(existsSync(join(extensionsDir, 'SC3plugins', 'BhobUGens', 'BMoog.sc')), true);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(extensionsDir, { recursive: true, force: true });
    if (movedAsidePath) rmSync(movedAsidePath, { recursive: true, force: true });
  }
});

test('installSc3Plugins throws and leaves extensionsDir untouched when fetchArchive fails', () => {
  const extensionsDir = mkdtempSync(join(tmpdir(), 'sc3ext-'));
  try {
    assert.throws(
      () => installSc3Plugins({
        extensionsDir,
        fetchArchive: () => { throw new Error('network down'); },
        log: () => {},
      }),
      /network down/,
    );
    assert.equal(existsSync(join(extensionsDir, 'SC3plugins')), false);
  } finally {
    rmSync(extensionsDir, { recursive: true, force: true });
  }
});
