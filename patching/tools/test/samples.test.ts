// Samples workflow tests (Task 7, Review Focus 5): parseShopping/parseLength unit cases, file
// matching, and an end-to-end conversion pass with a mix of good, extra and corrupt files.
// The ffmpeg/ffprobe-backed tests skip (not fail) when neither binary is on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignFiles,
  checkSamples,
  listAudioFiles,
  matchesSlot,
  parseLength,
  parseShopping,
  probe,
  writeManifest,
  writeSourcesSkeleton,
  type Slot,
} from '../src/samples.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'samples-check.ts');

function hasFfmpeg(): boolean {
  const ffmpeg = spawnSync('ffmpeg', ['-version']);
  const ffprobe = spawnSync('ffprobe', ['-version']);
  return !ffmpeg.error && ffmpeg.status === 0 && !ffprobe.error && ffprobe.status === 0;
}

function sh(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')} failed:\n${r.stderr}`);
}

function sine(path: string, freq: number, duration: number, channels: 1 | 2, sr = 44100): void {
  sh('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:duration=${duration}`,
    '-ar',
    String(sr),
    '-ac',
    String(channels),
    path,
  ]);
}

function corruptFile(path: string): void {
  writeFileSync(path, randomBytes(100));
}

function writeShopping(dir: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SHOPPING.md'), content);
}

function findTmpFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTmpFiles(p));
    else if (entry.name.includes('.tmp')) found.push(p);
  }
  return found;
}

function runCli(root: string, name: string): { code: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, name, '--dir', root], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const SHOPPING_FIXTURE = `# COS_Fixture samples

| slot | what | length | channels | pitched | licence |
|---|---|---|---|---|---|
| hit | a percussive hit | ≤ 1 s | mono | no | CC0 |
| bed | a soft drone bed | 4–10 s | stereo | yes | own recording |
`;

// --- parseLength -------------------------------------------------------------------------------

test('parseLength parses every length form (ruling 7)', () => {
  assert.deepEqual(parseLength('any'), [0, Infinity]);
  assert.deepEqual(parseLength('ANY'), [0, Infinity]);
  assert.deepEqual(parseLength('≤ 1 s'), [0, 1]);
  assert.deepEqual(parseLength('≤1s'), [0, 1]);
  assert.deepEqual(parseLength('4–10 s'), [4, 10]); // en dash
  assert.deepEqual(parseLength('4-10 s'), [4, 10]); // hyphen
  assert.deepEqual(parseLength('2 s'), [1, 4]); // bare
  assert.deepEqual(parseLength('2'), [1, 4]); // bare, no unit
  assert.throws(() => parseLength('whenever'), /unrecognised length/);
});

// --- parseShopping -------------------------------------------------------------------------------

test('parseShopping reads the table and ignores prose above and below it', () => {
  const md = `# Shopping list for COS_Fixture\n\nSome prose about the patch and what it wants.\n\n${SHOPPING_FIXTURE}\nNotes for Ciaran below the table are ignored too.\n`;
  const slots = parseShopping(md);
  assert.deepEqual(slots.map((s) => s.slot), ['hit', 'bed']);
  const expected: Slot[] = [
    { slot: 'hit', what: 'a percussive hit', lengthSec: [0, 1], channels: 'mono', pitched: false, licence: 'CC0' },
    { slot: 'bed', what: 'a soft drone bed', lengthSec: [4, 10], channels: 'stereo', pitched: true, licence: 'own recording' },
  ];
  assert.deepEqual(slots, expected);
});

test('parseShopping rejects a table with the wrong header', () => {
  assert.throws(
    () => parseShopping('| slot | what | length |\n|---|---|---|\n| hit | x | any |\n'),
    /table header must be/,
  );
});

// --- file matching -------------------------------------------------------------------------------

test('matchesSlot: prefix and bare-stem forms, case-insensitive', () => {
  assert.equal(matchesSlot('hit-crash.wav', 'hit'), true);
  assert.equal(matchesSlot('HIT-crash.WAV', 'hit'), true);
  assert.equal(matchesSlot('hit.wav', 'hit'), true);
  assert.equal(matchesSlot('HIT.WAV', 'hit'), true);
  assert.equal(matchesSlot('hitting.wav', 'hit'), false);
  assert.equal(matchesSlot('stray.wav', 'hit'), false);
});

test('listAudioFiles lists only recognised audio extensions, sorted, and never the wav/ folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-list-'));
  mkdirSync(join(dir, 'wav'));
  writeFileSync(join(dir, 'wav', 'hit.wav'), 'x');
  writeFileSync(join(dir, 'hit-crash.wav'), 'x');
  writeFileSync(join(dir, 'SHOPPING.md'), 'x');
  writeFileSync(join(dir, 'notes.txt'), 'x');
  writeFileSync(join(dir, 'bed-loop.aiff'), 'x');
  assert.deepEqual(listAudioFiles(dir), ['bed-loop.aiff', 'hit-crash.wav']);
});

test('assignFiles: first sorted match wins per slot; the rest and unmatched files are extras', () => {
  const slots: Slot[] = [
    { slot: 'hit', what: '', lengthSec: [0, 1], channels: 'mono', pitched: false, licence: '' },
    { slot: 'bed', what: '', lengthSec: [0, 1], channels: 'stereo', pitched: false, licence: '' },
  ];
  const { assigned, extras } = assignFiles(['bed-zz.wav', 'bed-loop.wav', 'hit-crash.wav', 'stray.wav'], slots);
  assert.equal(assigned.get('hit'), 'hit-crash.wav');
  assert.equal(assigned.get('bed'), 'bed-loop.wav');
  assert.deepEqual(extras.map((e) => e.file), ['bed-zz.wav', 'stray.wav']);
  assert.equal(extras.find((e) => e.file === 'bed-zz.wav')?.slot, 'bed');
  assert.equal(extras.find((e) => e.file === 'stray.wav')?.slot, undefined);
});

// --- writeManifest / writeSourcesSkeleton (pure fs, no ffmpeg) -------------------------------

test('writeManifest writes valid JSON with no .tmp left behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-manifest-'));
  const path = join(dir, 'manifest.json');
  writeManifest(path, { hit: { file: 'wav/hit.wav', frames: 19200, channels: 1, sr: 48000, source: 'hit-crash.wav', seconds: 0.4 } });
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(parsed.hit, { file: 'wav/hit.wav', frames: 19200, channels: 1, sr: 48000, source: 'hit-crash.wav', seconds: 0.4 });
  assert.deepEqual(findTmpFiles(dir), []);
});

test('writeSourcesSkeleton appends only missing slots and never touches existing rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-sources-'));
  const path = join(dir, 'SOURCES.md');

  writeSourcesSkeleton(path, [{ slot: 'hit', file: 'hit-crash.wav', licence: 'CC0' }]);
  const first = readFileSync(path, 'utf8');
  assert.match(first, /\|\s*hit\s*\|\s*hit-crash\.wav\s*\|\s*\|\s*\|\s*CC0\s*\|/);

  // Ciaran fills in a URL and author by hand.
  writeFileSync(path, first.replace('| hit | hit-crash.wav |  |  | CC0 |', '| hit | hit-crash.wav | https://example.com | Someone | CC0 |'));

  // A second run must not overwrite Ciaran's edit, and must append only the new slot.
  writeSourcesSkeleton(path, [
    { slot: 'hit', file: 'hit-crash.wav', licence: 'CC0' },
    { slot: 'bed', file: 'bed-loop.wav', licence: 'own recording' },
  ]);
  const second = readFileSync(path, 'utf8');
  assert.match(second, /https:\/\/example\.com/);
  assert.match(second, /Someone/);
  assert.match(second, /\|\s*bed\s*\|\s*bed-loop\.wav\s*\|/);
  assert.equal((second.match(/\| hit \|/g) ?? []).length, 1);
  assert.deepEqual(findTmpFiles(dir), []);
});

// --- checkSamples end to end (needs ffmpeg/ffprobe) -------------------------------------------

test('checkSamples: converts matched slots, flags extras, writes manifest + SOURCES.md, exits 1', (t) => {
  if (!hasFfmpeg()) { t.skip('ffmpeg/ffprobe not on PATH'); return; }
  const root = mkdtempSync(join(tmpdir(), 'cos-samples-'));
  const dir = join(root, 'COS_Fixture');
  writeShopping(dir, SHOPPING_FIXTURE);
  sine(join(dir, 'hit-crash.wav'), 440, 0.4, 2); // stereo -> hit wants mono: downmix
  sine(join(dir, 'bed-loop.wav'), 220, 6, 1); // mono -> bed wants stereo: upmix
  sine(join(dir, 'stray.wav'), 330, 0.3, 1); // matches no slot
  corruptFile(join(dir, 'bed-zz.wav')); // sorts after bed-loop.wav; extra, unreadable if chosen

  const result = checkSamples(dir);

  assert.equal(result.exitCode, 1);

  const hit = result.slots.find((s) => s.slot === 'hit');
  assert.equal(hit?.status, 'ok');
  if (hit?.status === 'ok') {
    assert.equal(hit.source, 'hit-crash.wav');
    assert.equal(hit.sourceChannels, 2);
    assert.equal(hit.conversionNote, 'stereo→mono');
    assert.equal(hit.lengthWarning, false);
    assert.equal(hit.entry.file, 'wav/hit.wav');
    assert.equal(hit.entry.channels, 1);
    assert.equal(hit.entry.sr, 48000);
    assert.equal(hit.entry.source, 'hit-crash.wav');
    assert.ok(Math.abs(hit.entry.seconds - 0.4) < 0.05, `hit seconds ${hit.entry.seconds}`);
    assert.ok(Number.isInteger(hit.entry.frames));
  }

  const bed = result.slots.find((s) => s.slot === 'bed');
  assert.equal(bed?.status, 'ok');
  if (bed?.status === 'ok') {
    assert.equal(bed.source, 'bed-loop.wav');
    assert.equal(bed.sourceChannels, 1);
    assert.equal(bed.conversionNote, 'mono→stereo');
    assert.equal(bed.lengthWarning, false);
    assert.equal(bed.entry.channels, 2);
    assert.equal(bed.entry.sr, 48000);
    assert.ok(Math.abs(bed.entry.seconds - 6) < 0.15, `bed seconds ${bed.entry.seconds}`);
  }

  assert.deepEqual(result.extras.map((e) => e.file), ['bed-zz.wav', 'stray.wav']);
  assert.equal(result.extras.find((e) => e.file === 'stray.wav')?.slot, undefined);
  assert.equal(result.extras.find((e) => e.file === 'bed-zz.wav')?.slot, 'bed');

  assert.ok(result.lines.some((l) => l.includes('stray.wav') && l.includes('matches no slot')));
  assert.ok(result.lines.some((l) => l.includes('bed-zz.wav')));
  assert.ok(result.lines.some((l) => l.startsWith('[ok] hit')));

  // Probe the converted files directly.
  const hitProbe = probe(join(dir, 'wav', 'hit.wav'));
  assert.equal(hitProbe.ok, true);
  if (hitProbe.ok) { assert.equal(hitProbe.channels, 1); assert.equal(hitProbe.sr, 48000); }
  const bedProbe = probe(join(dir, 'wav', 'bed.wav'));
  assert.equal(bedProbe.ok, true);
  if (bedProbe.ok) { assert.equal(bedProbe.channels, 2); assert.equal(bedProbe.sr, 48000); }

  // manifest.json on disk.
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['bed', 'hit']);
  assert.equal(manifest.hit.file, 'wav/hit.wav');
  assert.equal(manifest.hit.channels, 1);
  assert.equal(manifest.hit.sr, 48000);
  assert.equal(manifest.hit.source, 'hit-crash.wav');
  assert.equal(manifest.bed.channels, 2);

  // SOURCES.md skeleton.
  const sources = readFileSync(join(dir, 'SOURCES.md'), 'utf8');
  assert.match(sources, /\|\s*slot\s*\|\s*file\s*\|\s*url\s*\|\s*author\s*\|\s*licence\s*\|/i);
  assert.match(sources, /\|\s*hit\s*\|\s*hit-crash\.wav\s*\|\s*\|\s*\|\s*CC0\s*\|/);
  assert.match(sources, /\|\s*bed\s*\|\s*bed-loop\.wav\s*\|\s*\|\s*\|\s*own recording\s*\|/);

  // Never a half-written file anywhere under the fixture.
  assert.deepEqual(findTmpFiles(dir), []);
});

test('a clean run (every file matches a slot, nothing extra) exits 0', (t) => {
  if (!hasFfmpeg()) { t.skip('ffmpeg/ffprobe not on PATH'); return; }
  const root = mkdtempSync(join(tmpdir(), 'cos-samples-'));
  const dir = join(root, 'COS_Clean');
  writeShopping(dir, SHOPPING_FIXTURE);
  sine(join(dir, 'hit-crash.wav'), 440, 0.4, 2);
  sine(join(dir, 'bed-loop.wav'), 220, 6, 1);

  const result = checkSamples(dir);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.extras, []);
  assert.ok(result.slots.every((s) => s.status === 'ok'));
  assert.deepEqual(findTmpFiles(dir), []);
});

test('a slot whose only matching file is corrupt is reported unreadable, and the run exits 1', (t) => {
  if (!hasFfmpeg()) { t.skip('ffmpeg/ffprobe not on PATH'); return; }
  const root = mkdtempSync(join(tmpdir(), 'cos-samples-'));
  const dir = join(root, 'COS_Broken');
  writeShopping(
    dir,
    '| slot | what | length | channels | pitched | licence |\n|---|---|---|---|---|---|\n| x | anything | any | mono | no | CC0 |\n',
  );
  corruptFile(join(dir, 'x-broken.wav'));

  const result = checkSamples(dir);
  assert.equal(result.exitCode, 1);
  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0]?.status, 'unreadable');
  assert.deepEqual(result.extras, []);
  assert.ok(result.lines.some((l) => l.includes('x: unreadable')));

  // manifest.json is still written (partial progress visible) — empty, since the one slot failed.
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, {});
  assert.deepEqual(findTmpFiles(dir), []);
});

// --- CLI ------------------------------------------------------------------------------------

test('CLI: exits 2 on bad usage', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('CLI: exits 2 when SHOPPING.md is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'cos-samples-'));
  mkdirSync(join(root, 'COS_NoShopping'), { recursive: true });
  const r = runCli(root, 'COS_NoShopping');
  assert.equal(r.code, 2);
});

test('CLI: end-to-end run lists the stray file and exits 1, with no manifest.json.tmp left', (t) => {
  if (!hasFfmpeg()) { t.skip('ffmpeg/ffprobe not on PATH'); return; }
  const root = mkdtempSync(join(tmpdir(), 'cos-samples-'));
  const dir = join(root, 'COS_Fixture');
  writeShopping(dir, SHOPPING_FIXTURE);
  sine(join(dir, 'hit-crash.wav'), 440, 0.4, 2);
  sine(join(dir, 'bed-loop.wav'), 220, 6, 1);
  sine(join(dir, 'stray.wav'), 330, 0.3, 1);
  corruptFile(join(dir, 'bed-zz.wav'));

  const r = runCli(root, 'COS_Fixture');
  assert.equal(r.code, 1);
  assert.match(r.out, /stray\.wav/);
  assert.match(r.out, /matches no slot/);
  assert.ok(existsSync(join(dir, 'manifest.json')));
  assert.deepEqual(findTmpFiles(dir), []);
});

test('CLI: a clean fixture exits 0', (t) => {
  if (!hasFfmpeg()) { t.skip('ffmpeg/ffprobe not on PATH'); return; }
  const root = mkdtempSync(join(tmpdir(), 'cos-samples-'));
  const dir = join(root, 'COS_Clean');
  writeShopping(dir, SHOPPING_FIXTURE);
  sine(join(dir, 'hit-crash.wav'), 440, 0.4, 2);
  sine(join(dir, 'bed-loop.wav'), 220, 6, 1);

  const r = runCli(root, 'COS_Clean');
  assert.equal(r.code, 0);
});
