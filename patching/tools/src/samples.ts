// Samples workflow (spec §8, ruling 7, Review Focus 5): SHOPPING.md written by the skill,
// files Ciaran drops into samples/COS_<Name>/ matched to slots by filename, converted to
// 48 kHz WAV via ffmpeg/ffprobe, manifest.json and a SOURCES.md skeleton written out.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
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
  | { slot: string; status: 'unreadable'; error: string }
  | { slot: string; status: 'conversion-failed'; error: string };

/** A file that either duplicates another (already-chosen) match for `slot` (a warning — `chosen`
 * names the file that won instead), or (when `slot` is absent) matches no slot at all (a
 * problem: it forces `checkSamples`'s exit code to 1). */
export interface ExtraFile {
  file: string;
  slot?: string;
  chosen?: string;
}

export interface CheckResult {
  slots: SlotOutcome[];
  extras: ExtraFile[];
  manifest: Manifest;
  lines: string[];
  exitCode: 0 | 1;
}

export interface CheckOptions {
  /** The ffmpeg binary `convert()` invokes; overridable for tests that need a conversion to
   * fail deliberately (a real corrupt/unreadable source already fails at `probe()`, before
   * ffmpeg is ever run). Defaults to `'ffmpeg'` (resolved via PATH). */
  ffmpegBin?: string;
  /** The ffprobe binary `probe()` invokes (default `'ffprobe'` on PATH). */
  ffprobeBin?: string;
}

/** ffmpeg or ffprobe is not installed (spawn ENOENT): the whole run cannot work, so this is
 * thrown out of `checkSamples` instead of reporting every slot unreadable. */
export class MissingToolError extends Error {
  tool: string;
  constructor(tool: string) {
    super(`${tool} not found — install ffmpeg (brew install ffmpeg)`);
    this.name = 'MissingToolError';
    this.tool = tool;
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}

// --- SHOPPING.md ---------------------------------------------------------------------------

const LENGTH_HEADER = ['slot', 'what', 'length', 'channels', 'pitched', 'licence'];

// A markdown table separator row: one or more `|`-delimited cells of dashes (with optional
// alignment colons), e.g. `|---|:--|--:|`. Used to catch a SHOPPING.md/SOURCES.md whose
// separator row is missing or malformed — without this check, the first data row would
// silently be skipped as if it were the separator, dropping one slot with no error at all.
const SEPARATOR_RE = /^\|(\s*:?-+:?\s*\|)+$/;

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
    // Ruling: a bare number describes an approximate target, not a hard bound — the actual
    // sample found is very unlikely to be exactly that long, so the window is deliberately
    // wide (half to double) rather than a tight tolerance around x.
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
  if (!SEPARATOR_RE.test(pipeLines[1]!)) {
    throw new Error('SHOPPING.md: expected a |---| separator row after the header');
  }

  const slots: Slot[] = [];
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

/** Assigns each slot its first (sorted) matching file; every other matching file for that slot
 * comes back as an extra with `chosen` set (a warning, not a problem — ruling); every file
 * matching no slot at all comes back as an extra with no `slot` (a problem: it forces the exit
 * code to 1). */
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
      extras.push({ file: extra, slot: s.slot, chosen: first });
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
 * A non-zero exit or unparsable output both come back as `{ ok: false, error }`; a missing
 * ffprobe (spawn ENOENT) throws MissingToolError. */
export function probe(file: string, ffprobeBin = 'ffprobe'): ProbeResult {
  const r = spawnSync(
    ffprobeBin,
    ['-v', 'error', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', file],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (r.error && isEnoent(r.error)) throw new MissingToolError(ffprobeBin);
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

/** Thrown by `convert()` on a non-zero ffmpeg exit; `stderr` carries ffmpeg's raw stderr
 * (possibly multi-line) so callers can report just its first line. */
export class ConvertError extends Error {
  stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.name = 'ConvertError';
    this.stderr = stderr;
  }
}

/** `<ffmpegBin> -y -v error -i <src> -ar 48000 -ac <1|2> -c:a pcm_s24le <dst>`, written to
 * `<dst>.tmp.wav` (ffmpeg needs a `.wav` suffix to pick the muxer) then renamed to `dst`. On
 * failure throws `ConvertError` and always removes `<dst>.tmp.wav` (whatever partial output
 * ffmpeg may have left) in a `finally`, so a failed conversion never leaves stray output. */
export function convert(src: string, dst: string, channels: 1 | 2, ffmpegBin = 'ffmpeg'): void {
  mkdirSync(dirname(dst), { recursive: true });
  const tmp = `${dst}.tmp.wav`;
  try {
    const r = spawnSync(
      ffmpegBin,
      ['-y', '-v', 'error', '-i', src, '-ar', '48000', '-ac', String(channels), '-c:a', 'pcm_s24le', tmp],
      { encoding: 'utf8', timeout: 60000 },
    );
    if (r.error && isEnoent(r.error)) throw new MissingToolError(ffmpegBin);
    if (r.error || r.status !== 0) {
      // r.error is only sometimes set (a spawn failure, e.g. ENOENT) — String(undefined) would
      // otherwise stringify to the truthy "undefined" and mask the real fallback message below.
      const stderr = (r.stderr || (r.error ? String(r.error) : '') || `ffmpeg exited ${r.status}`).trim();
      throw new ConvertError(`ffmpeg failed converting ${src} -> ${dst}: ${stderr}`, stderr);
    }
    renameSync(tmp, dst);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// --- manifest.json / SOURCES.md -----------------------------------------------------------

/** Written via `writeAtomic` — never a half-written `manifest.json`, and this is called only
 * once, after every conversion this run is going to attempt has finished. */
export function writeManifest(path: string, manifest: Manifest): void {
  writeAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The manifest already on disk: `{}` if there is none yet, it doesn't parse, or it is not a
 * JSON object (an array, say); otherwise only the entries that are plain objects with a string
 * `file` (anything else could not be checked against the disk, and would crash the merge). */
export function readExistingManifest(path: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const out: Manifest = {};
  for (const [slot, entry] of Object.entries(parsed)) {
    if (isPlainObject(entry) && typeof entry.file === 'string') out[slot] = entry as unknown as ManifestEntry;
  }
  return out;
}

/** Merges this run's successful conversions into the manifest already on disk (ruling: manifest
 * drift): start from the existing entries, overwrite with this run's successes, and drop an
 * entry only when its `file` no longer exists under `dir` — so a slot whose source vanished but
 * whose converted WAV is still there keeps its manifest entry, and only actually losing the WAV
 * removes it. */
function mergeManifest(dir: string, existing: Manifest, converted: Manifest): Manifest {
  const merged: Manifest = { ...existing, ...converted };
  for (const slot of Object.keys(merged)) {
    if (!existsSync(join(dir, merged[slot]!.file))) delete merged[slot];
  }
  return merged;
}

function existingSourceSlots(md: string): Set<string> {
  const pipeLines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|') && l.length >= 2);
  const slots = new Set<string>();
  if (pipeLines.length < 2) return slots;
  if (!SEPARATOR_RE.test(pipeLines[1]!)) {
    throw new Error('SOURCES.md: expected a |---| separator row after the header');
  }
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
    } else if (o.status === 'unreadable') {
      lines.push(`[!!] ${o.slot}: unreadable (${o.error})`);
    } else {
      lines.push(`[!!] ${o.slot}: conversion failed (${o.error})`);
    }
  }
  for (const e of extras) {
    if (e.slot) lines.push(`[??] extra file ${e.file} — slot ${e.slot} already has ${e.chosen}`);
    else lines.push(`[??] extra file ${e.file} matches no slot`);
  }
  const ok = slots.filter((o) => o.status === 'ok').length;
  // Warnings: a length outside the slot's range (still converted), and a same-slot duplicate
  // file (not used, but not an error either). Problems: a slot that didn't convert, and a file
  // that matches no slot at all — these are what forces the exit code to 1.
  const warnings = slots.filter((o) => o.status === 'ok' && o.lengthWarning).length + extras.filter((e) => e.slot).length;
  const problems = slots.filter((o) => o.status !== 'ok').length + extras.filter((e) => !e.slot).length;
  lines.push(`${ok}/${slots.length} slot(s) converted, ${warnings} warning(s), ${problems} problem(s)`);
  return lines;
}

/** Runs the whole check over `dir` (a `samples/COS_<Name>` folder that already has a
 * `SHOPPING.md`): matches files to slots, converts what it can (a conversion failure is caught
 * per slot and does not abort the run), merges the result into any `manifest.json` already on
 * disk and writes a `SOURCES.md` skeleton, and returns the report lines and exit code (Review
 * Focus 5). Throws for a malformed `SHOPPING.md`/`SOURCES.md` (the CLI treats that as a
 * usage error) and MissingToolError when ffmpeg/ffprobe is not installed (checked lazily, on the
 * first slot that needs it; nothing is written in that case). */
export function checkSamples(dir: string, opts: CheckOptions = {}): CheckResult {
  const ffmpegBin = opts.ffmpegBin ?? 'ffmpeg';
  const ffprobeBin = opts.ffprobeBin ?? 'ffprobe';
  const slots = parseShopping(readFileSync(join(dir, 'SHOPPING.md'), 'utf8'));
  const files = listAudioFiles(dir);
  const { assigned, extras } = assignFiles(files, slots);

  const outcomes: SlotOutcome[] = [];
  const converted: Manifest = {};

  for (const s of slots) {
    const file = assigned.get(s.slot);
    if (!file) {
      outcomes.push({ slot: s.slot, status: 'missing' });
      continue;
    }
    const srcPath = join(dir, file);
    const sourceProbe = probe(srcPath, ffprobeBin);
    if (!sourceProbe.ok) {
      outcomes.push({ slot: s.slot, status: 'unreadable', error: sourceProbe.error });
      continue;
    }
    const targetChannels: 1 | 2 = s.channels === 'mono' ? 1 : 2;
    const dstPath = join(dir, 'wav', `${s.slot}.wav`);
    let convertedProbe: ProbeResult;
    try {
      convert(srcPath, dstPath, targetChannels, ffmpegBin);
      convertedProbe = probe(dstPath, ffprobeBin);
    } catch (e) {
      if (e instanceof MissingToolError) throw e;
      const stderr = e instanceof ConvertError ? e.stderr : (e as Error).message;
      outcomes.push({ slot: s.slot, status: 'conversion-failed', error: (stderr.split('\n')[0] ?? stderr).trim() });
      continue;
    }
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
      // Not read directly from ffprobe (the fixed command above requests duration, not
      // nb_samples): derived from the re-probed converted file's duration × sample rate.
      frames: Math.round(convertedProbe.seconds * convertedProbe.sr),
      channels: convertedProbe.channels as 1 | 2,
      sr: convertedProbe.sr,
      source: file,
      seconds: convertedProbe.seconds,
    };
    converted[s.slot] = entry;
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

  const manifestPath = join(dir, 'manifest.json');
  const manifest = mergeManifest(dir, readExistingManifest(manifestPath), converted);
  writeManifest(manifestPath, manifest);
  writeSourcesSkeleton(
    join(dir, 'SOURCES.md'),
    outcomes
      .filter((o): o is Extract<SlotOutcome, { status: 'ok' }> => o.status === 'ok')
      .map((o) => ({ slot: o.slot, file: o.source, licence: slots.find((s) => s.slot === o.slot)!.licence })),
  );

  // A same-slot duplicate extra is a warning only; a file matching no slot is a problem.
  const exitCode: 0 | 1 = outcomes.some((o) => o.status !== 'ok') || extras.some((e) => !e.slot) ? 1 : 0;
  return { slots: outcomes, extras, manifest, lines: buildLines(outcomes, extras), exitCode };
}
