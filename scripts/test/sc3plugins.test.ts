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
