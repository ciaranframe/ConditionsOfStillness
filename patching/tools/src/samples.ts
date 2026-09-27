// Samples workflow (spec §8, ruling 7, Review Focus 5): SHOPPING.md written by the skill,
// files Ciaran drops into samples/COS_<Name>/ matched to slots by filename, converted to
// 48 kHz WAV via ffmpeg/ffprobe, manifest.json and a SOURCES.md skeleton written out.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join } from 'node:path';
import { writeAtomic } from './atomic.ts';

export type Channels = 'mono' | 'stereo';

export interface Slot {
  slot: string;
  what: string;
  lengthSec: [number, number];
  channels: Channels;
  pitched: boolean;
  licence: string;
}

export interface ManifestEntry {
  file: string;
  frames: number;
  channels: 1 | 2;
  sr: number;
  source: string;
  seconds: number;
}

export type Manifest = Record<string, ManifestEntry>;

export type SlotOutcome =
  | {
      slot: string;
      status: 'ok';
      source: string;
      sourceSeconds: number;
      sourceChannels: number;
      lengthWarning: boolean;
      conversionNote?: string;
      entry: ManifestEntry;
    }
  | { slot: string; status: 'missing' }
  | { slot: string; status: 'unreadable'; error: string };

/** A file that either duplicates another (already-chosen) match for `slot`, or (when `slot` is
 * absent) matches no slot at all. */
export interface ExtraFile {
  file: string;
  slot?: string;
}

export interface CheckResult {
  slots: SlotOutcome[];
  extras: ExtraFile[];
  manifest: Manifest;
  lines: string[];
  exitCode: 0 | 1;
}

// --- SHOPPING.md ---------------------------------------------------------------------------

const LENGTH_HEADER = ['slot', 'what', 'length', 'channels', 'pitched', 'licence'];

/** `length` column forms (ruling 7): `any` -> [0, Infinity]; `≤ x` -> [0, x]; `a–b` (en dash or
 * hyphen) -> [a, b]; a bare `x` -> [x*0.5, x*2]. Whitespace and an optional trailing `s` unit
 * are tolerated throughout. */
export function parseLength(raw: string): [number, number] {
  const s = raw.trim();
  if (/^any$/i.test(s)) return [0, Infinity];
  const leq = s.match(/^≤\s*([\d.]+)\s*s?$/i);
  if (leq) return [0, Number(leq[1])];
  const range = s.match(/^([\d.]+)\s*[–-]\s*([\d.]+)\s*s?$/);
  if (range) return [Number(range[1]), Number(range[2])];
  const bare = s.match(/^([\d.]+)\s*s?$/);
  if (bare) {
    const x = Number(bare[1]);
    return [x * 0.5, x * 2];
  }
  throw new Error(`SHOPPING.md: unrecognised length "${raw}"`);
}

function pipeCells(line: string): string[] {
  return line.slice(1, -1).split('|').map((c) => c.trim());
}

/** Reads the `| slot | what | length | channels | pitched | licence |` table (a header row, a
 * separator row, one row per slot); lines above/below the table (headings, prose) are ignored —
 * only lines that both start and end with `|` are considered. */
export function parseShopping(md: string): Slot[] {
  const pipeLines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|') && l.length >= 2);
  if (pipeLines.length < 2) throw new Error('SHOPPING.md: no table found');

  const header = pipeCells(pipeLines[0]!).map((c) => c.toLowerCase());
  if (header.length !== LENGTH_HEADER.length || !LENGTH_HEADER.every((c, i) => header[i] === c)) {
    throw new Error(
      `SHOPPING.md: table header must be | ${LENGTH_HEADER.join(' | ')} |, got: ${pipeLines[0]}`,
    );
  }

  const slots: Slot[] = [];
  // pipeLines[1] is the `|---|` separator row — skipped unconditionally.
  for (const line of pipeLines.slice(2)) {
    const cells = pipeCells(line);
    if (cells.length !== LENGTH_HEADER.length) {
      throw new Error(`SHOPPING.md: row has ${cells.length} columns, expected ${LENGTH_HEADER.length}: ${line}`);
    }
    const [slot, what, length, channelsRaw, pitchedRaw, licence] = cells as [string, string, string, string, string, string];
    const channels = channelsRaw.toLowerCase();
    if (channels !== 'mono' && channels !== 'stereo') {
      throw new Error(`SHOPPING.md: slot ${slot} channels must be mono or stereo, got "${channelsRaw}"`);
    }
    const pitchedLower = pitchedRaw.toLowerCase();
    if (pitchedLower !== 'yes' && pitchedLower !== 'no') {
      throw new Error(`SHOPPING.md: slot ${slot} pitched must be yes or no, got "${pitchedRaw}"`);
    }
    slots.push({ slot, what, lengthSec: parseLength(length), channels, pitched: pitchedLower === 'yes', licence });
  }
  return slots;
}

// --- file matching ---------------------------------------------------------------------------

const AUDIO_EXTS = new Set(['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a']);

/** Files directly under `dir` (never the `wav/` output folder, since `readdirSync` without
 * `recursive` never descends into it) whose extension is an audio one, sorted. */
export function listAudioFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => AUDIO_EXTS.has(extname(name).slice(1).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

/** A file belongs to `slot` when its basename starts with `<slot>-` or equals `<slot>.<ext>`
 * (case-insensitive). */
export function matchesSlot(basename: string, slot: string): boolean {
  const name = basename.toLowerCase();
  const s = slot.toLowerCase();
  if (name.startsWith(`${s}-`)) return true;
  const dot = name.lastIndexOf('.');
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  return stem === s;
}

/** Assigns each slot its first (sorted) matching file; every other matching file for that slot,
 * and every file matching no slot at all, comes back as an `extra`. */
export function assignFiles(files: string[], slots: Slot[]): { assigned: Map<string, string>; extras: ExtraFile[] } {
  const assigned = new Map<string, string>();
  const claimed = new Set<string>();
  const extras: ExtraFile[] = [];
  for (const s of slots) {
    const matches = files.filter((f) => matchesSlot(f, s.slot)).sort((a, b) => a.localeCompare(b));
    if (matches.length === 0) continue;
    const [first, ...rest] = matches;
    assigned.set(s.slot, first!);
    claimed.add(first!);
    for (const extra of rest) {
      extras.push({ file: extra, slot: s.slot });
      claimed.add(extra);
    }
  }
  for (const f of files) {
    if (!claimed.has(f)) extras.push({ file: f });
  }
  extras.sort((a, b) => a.file.localeCompare(b.file));
  return { assigned, extras };
}

// --- ffprobe / ffmpeg ------------------------------------------------------------------------

export type ProbeResult = { ok: true; channels: number; sr: number; seconds: number } | { ok: false; error: string };

/** `ffprobe -v error -show_entries stream=channels,sample_rate:format=duration -of json <file>`.
 * A non-zero exit or unparsable output both come back as `{ ok: false, error }`. */
export function probe(file: string): ProbeResult {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', file],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (r.error) return { ok: false, error: String((r.error as Error).message ?? r.error) };
  if (r.status !== 0) return { ok: false, error: (r.stderr || `ffprobe exited ${r.status}`).trim() };
  let parsed: any;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    return { ok: false, error: `ffprobe output unparsable: ${(e as Error).message}` };
  }
  const stream = parsed?.streams?.[0];
  const format = parsed?.format;
  const channels = Number(stream?.channels);
  const sr = Number(stream?.sample_rate);
  const seconds = Number(format?.duration);
  if (!stream || !format || !Number.isFinite(channels) || !Number.isFinite(sr) || !Number.isFinite(seconds)) {
    return { ok: false, error: `ffprobe output unparsable: ${r.stdout.slice(0, 200)}` };
  }
  return { ok: true, channels, sr, seconds };
}

/** `ffmpeg -y -v error -i <src> -ar 48000 -ac <1|2> -c:a pcm_s24le <dst>`, written to
 * `<dst>.tmp.wav` (ffmpeg needs a `.wav` suffix to pick the muxer) then renamed to `dst`. */
export function convert(src: string, dst: string, channels: 1 | 2): void {
  mkdirSync(dirname(dst), { recursive: true });
  const tmp = `${dst}.tmp.wav`;
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', src, '-ar', '48000', '-ac', String(channels), '-c:a', 'pcm_s24le', tmp],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (r.error || r.status !== 0) {
    throw new Error(`ffmpeg failed converting ${src} -> ${dst}: ${(r.stderr || String(r.error) || `exit ${r.status}`).trim()}`);
  }
  renameSync(tmp, dst);
}

// --- manifest.json / SOURCES.md -----------------------------------------------------------

/** Written via `writeAtomic` — never a half-written `manifest.json`, and this is called only
 * once, after every conversion this run is going to attempt has finished. */
export function writeManifest(path: string, manifest: Manifest): void {
  writeAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function existingSourceSlots(md: string): Set<string> {
  const pipeLines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|') && l.length >= 2);
  const slots = new Set<string>();
  // Skip header + separator (first two rows), same shape as parseShopping.
  for (const line of pipeLines.slice(2)) {
    const first = pipeCells(line)[0];
    if (first) slots.add(first);
  }
  return slots;
}

export interface SourceRow {
  slot: string;
  file: string;
  licence: string;
}

/** `| slot | file | url | author | licence |` skeleton — `file` and `licence` filled from the
 * conversion and `SHOPPING.md`, `url`/`author` left blank for Ciaran. Written only if
 * `SOURCES.md` does not already exist; otherwise rows for slots not yet present are appended,
 * and Ciaran's existing notes are never touched. */
export function writeSourcesSkeleton(path: string, rows: SourceRow[]): void {
  const row = (r: SourceRow) => `| ${r.slot} | ${r.file} |  |  | ${r.licence} |\n`;
  if (!existsSync(path)) {
    const header = '| slot | file | url | author | licence |\n|---|---|---|---|---|\n';
    writeAtomic(path, header + rows.map(row).join(''));
    return;
  }
  const existing = readFileSync(path, 'utf8');
  const known = existingSourceSlots(existing);
  const toAdd = rows.filter((r) => !known.has(r.slot));
  if (toAdd.length === 0) return;
  const base = existing.endsWith('\n') ? existing : `${existing}\n`;
  writeAtomic(path, base + toAdd.map(row).join(''));
}

// --- orchestration ---------------------------------------------------------------------------

function formatSeconds(s: number): string {
  return s.toFixed(1);
}

function buildLines(slots: SlotOutcome[], extras: ExtraFile[]): string[] {
  const lines: string[] = [];
  for (const o of slots) {
    if (o.status === 'ok') {
      const notes = [`${formatSeconds(o.sourceSeconds)} s`];
      if (o.conversionNote) notes.push(o.conversionNote);
      if (o.lengthWarning) notes.push('length out of range');
      lines.push(`[ok] ${o.slot} ← ${o.source} (${notes.join(', ')})`);
    } else if (o.status === 'missing') {
      lines.push(`[!!] ${o.slot}: missing`);
    } else {
      lines.push(`[!!] ${o.slot}: unreadable (${o.error})`);
    }
  }
  for (const e of extras) {
    if (e.slot) lines.push(`[??] extra file ${e.file} also matches slot ${e.slot}`);
    else lines.push(`[??] extra file ${e.file} matches no slot`);
  }
  const ok = slots.filter((o) => o.status === 'ok').length;
  const warnings = slots.filter((o) => o.status === 'ok' && o.lengthWarning).length;
  const problems = slots.filter((o) => o.status !== 'ok').length + extras.length;
  lines.push(`${ok}/${slots.length} slot(s) converted, ${warnings} warning(s), ${problems} problem(s)`);
  return lines;
}

/** Runs the whole check over `dir` (a `samples/COS_<Name>` folder that already has a
 * `SHOPPING.md`): matches files to slots, converts what it can, writes `manifest.json` (slots
 * that succeeded only, even on a failing run) and a `SOURCES.md` skeleton, and returns the
 * report lines and exit code (Review Focus 5). */
export function checkSamples(dir: string): CheckResult {
  const slots = parseShopping(readFileSync(join(dir, 'SHOPPING.md'), 'utf8'));
  const files = listAudioFiles(dir);
  const { assigned, extras } = assignFiles(files, slots);

  const outcomes: SlotOutcome[] = [];
  const manifest: Manifest = {};

  for (const s of slots) {
    const file = assigned.get(s.slot);
    if (!file) {
      outcomes.push({ slot: s.slot, status: 'missing' });
      continue;
    }
    const srcPath = join(dir, file);
    const sourceProbe = probe(srcPath);
    if (!sourceProbe.ok) {
      outcomes.push({ slot: s.slot, status: 'unreadable', error: sourceProbe.error });
      continue;
    }
    const targetChannels: 1 | 2 = s.channels === 'mono' ? 1 : 2;
    const dstPath = join(dir, 'wav', `${s.slot}.wav`);
    convert(srcPath, dstPath, targetChannels);
    const convertedProbe = probe(dstPath);
    if (!convertedProbe.ok) {
      outcomes.push({ slot: s.slot, status: 'unreadable', error: `converted file unreadable: ${convertedProbe.error}` });
      continue;
    }
    let conversionNote: string | undefined;
    if (targetChannels === 1 && sourceProbe.channels !== 1) conversionNote = 'stereo→mono';
    else if (targetChannels === 2 && sourceProbe.channels === 1) conversionNote = 'mono→stereo';
    const lengthWarning = sourceProbe.seconds < s.lengthSec[0] || sourceProbe.seconds > s.lengthSec[1];
    const entry: ManifestEntry = {
      file: `wav/${s.slot}.wav`,
      frames: Math.round(convertedProbe.seconds * convertedProbe.sr),
      channels: convertedProbe.channels as 1 | 2,
      sr: convertedProbe.sr,
      source: file,
      seconds: convertedProbe.seconds,
    };
    manifest[s.slot] = entry;
    outcomes.push({
      slot: s.slot,
      status: 'ok',
      source: file,
      sourceSeconds: sourceProbe.seconds,
      sourceChannels: sourceProbe.channels,
      lengthWarning,
      conversionNote,
      entry,
    });
  }

  writeManifest(join(dir, 'manifest.json'), manifest);
  writeSourcesSkeleton(
    join(dir, 'SOURCES.md'),
    outcomes
      .filter((o): o is Extract<SlotOutcome, { status: 'ok' }> => o.status === 'ok')
      .map((o) => ({ slot: o.slot, file: o.source, licence: slots.find((s) => s.slot === o.slot)!.licence })),
  );

  const exitCode: 0 | 1 = outcomes.some((o) => o.status !== 'ok') || extras.length > 0 ? 1 : 0;
  return { slots: outcomes, extras, manifest, lines: buildLines(outcomes, extras), exitCode };
}
