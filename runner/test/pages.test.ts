import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const pub = new URL('../public/', import.meta.url).pathname;

test('pages reference only local assets and every referenced asset exists', () => {
  for (const page of ['perform.html', 'admin.html']) {
    const html = readFileSync(join(pub, page), 'utf8');
    assert.doesNotMatch(html, /https?:\/\//, `${page} must not load anything from the network`);
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(existsSync(join(pub, m[1]!)), `${page}: missing ${m[1]}`);
  }
  const fonts = readdirSync(join(pub, 'fonts'));
  for (const f of ['ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-latin-700-normal.woff2', 'ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-600-normal.woff2']) assert.ok(fonts.includes(f), f);
  const css = readFileSync(join(pub, 'fonts.css'), 'utf8');
  assert.equal((css.match(/@font-face/g) ?? []).length, 5);
});

test('every page module parses as an ES module', () => {
  for (const f of readdirSync(join(pub, 'js'))) {
    const r = spawnSync(process.execPath, ['--check', join(pub, 'js', f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('Space on a focused button is left to the button; buttons blur after a click; Admin cues are off while panicked', () => {
  const ui = readFileSync(join(pub, 'js', 'ui.js'), 'utf8');
  assert.match(ui, /e\.code === 'Space' && tag === 'BUTTON'\) return/);
  assert.match(ui, /addEventListener\('click', blur\)/);
  const admin = readFileSync(join(pub, 'js', 'admin.js'), 'utf8');
  assert.match(admin, /canNext = online && !panicked/);
  assert.match(admin, /canBack = online && !panicked/);
  assert.match(admin, /disabled=\$\{!online \|\| panicked\}/);
  assert.match(admin, /key=\$\{`\$\{h\.id\}@\$\{h\.ip\}`\}/);
});
