// Static lint for a Conditions of Stillness personality — no SuperCollider involved; this is the
// gate before a patch reaches airkit/personalities/, where the engine hot-loads whatever is there.
//
// Adapted from Glimmer's airkit-glimmer/tools/patch-lint.ts (Ciaran Frame, 2026): stripNonCode,
// the hook-body matcher, the class-index builder, the SynthDef scanner, the tick-body checks and
// most banned-pattern regexes are copied from it. Changes: parameterised by the piece profile's
// YAML front-matter (patching/profile.md); Glimmer's name.glim-prefix and overlay/upstream-
// collision rules dropped; COS rules added (header.keys, name.cos-prefix, name.two-hand,
// hooks.scene-params, partner.guard, sample.manifest, state.idle-alias, roster.missing, the
// engine's SynthDef names); issues carry {id, severity E|W, file, line, message}.
// Rule list and rationale: plan ruling 6 and the Task 3 brief; the engine contract they encode is
// airkit/code3.0/API.md "[COS] Personality contract additions" and spec §5 / §5.1.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { repoRoot } from './sc.ts';

export type Severity = 'E' | 'W';
export type Issue = { id: string; severity: Severity; file: string; line: number; message: string };

export type Profile = {
  path: string;
  prefix: string;
  synthdefPrefix: string;
  roster: string; // absolute
  personalities: string; // absolute
  template: string; // absolute
  headerKeys: string[];
  optionalHeaderKeys: string[];
  samplesVar: string;
  plugins: boolean;
  gestureWords: string[];
};

export type LintOptions = { profile?: Profile; classDirs?: string[]; file?: string };

export const CLASS_DIRS = [
  '/Applications/SuperCollider.app/Contents/Resources/SCClassLibrary',
  join(homedir(), 'Library/Application Support/SuperCollider/Extensions'),
  '/Library/Application Support/SuperCollider/Extensions',
];
// Defined by the engine itself (airkit/code3.0/conditions/main_conditions.scd); also rescanned
// from that folder when it exists, so a new engine SynthDef is caught without editing this list.
const ENGINE_SYNTHDEFS = ['cosWristMonitor', 'cosAuditionMonitor', 'cosMaster'];
const REQUIRED_HOOKS = ['~init', '~deinit', '~onRoomState', '~idleNext'];
const STATE_TICKS = ['~tuningNext', '~pieceNext', '~curtainNext'];
const TICK_HOOKS = ['~next', '~idleNext', '~tuningNext', '~pieceNext', '~curtainNext'];
const MAX_SIZE_BYTES = 64 * 1024;
const MIN_LIBRARY_CLASSES = 500;

// --- profile ---------------------------------------------------------------------------------

export function defaultProfilePath(): string {
  return join(repoRoot(), 'patching', 'profile.md');
}

// The profile's YAML front-matter (between the leading `---` lines); paths are repo-relative.
export function loadProfile(path = defaultProfilePath()): Profile {
  const text = readFileSync(path, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error(`${path}: no YAML front-matter block`);
  const y = parse(m[1]!) as Record<string, unknown>;
  const str = (k: string): string => {
    if (typeof y[k] !== 'string' || y[k] === '') throw new Error(`${path}: front-matter "${k}" must be a string`);
    return y[k] as string;
  };
  const list = (k: string): string[] => {
    const v = y[k];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`${path}: front-matter "${k}" must be a list of strings`);
    return v as string[];
  };
  const root = repoRoot();
  const abs = (p: string): string => (isAbsolute(p) ? p : join(root, p));
  return {
    path,
    prefix: str('prefix'),
    synthdefPrefix: str('synthdefPrefix'),
    roster: abs(str('roster')),
    personalities: abs(str('personalities')),
    template: abs(str('template')),
    headerKeys: list('headerKeys'),
    optionalHeaderKeys: list('optionalHeaderKeys'),
    samplesVar: str('samplesVar'),
    plugins: y.plugins === true,
    gestureWords: list('gestureWords'),
  };
}

// --- source scanning (from Glimmer) ---------------------------------------------------------

/**
 * Blank out comments, strings, symbols and char literals, keeping every newline and column, so
 * an index into the result is an index into the source. `keepSymbols`/`keepStrings` leave those
 * intact (comments are always blanked) for checks that need `\silent` or a path literal.
 */
export function stripNonCode(src: string, keep: { symbols?: boolean; strings?: boolean } = {}): string {
  const out = src.split('');
  const blank = (from: number, to: number) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '*') { // SC block comments nest
      let depth = 1, j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; }
        else if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      blank(i, j); i = j;
    } else if (c === '/' && n === '/') {
      let j = i; while (j < src.length && src[j] !== '\n') j++;
      blank(i, j); i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      const isString = c === '"';
      if (!(isString ? keep.strings : keep.symbols)) blank(i + 1, Math.min(j, src.length));
      i = j + 1;
    } else if (c === '$') { if (!keep.strings) blank(i, i + 2); i += 2; }
    else if (c === '\\' && /[A-Za-z_]/.test(n ?? '')) {
      let j = i + 1; while (j < src.length && /\w/.test(src[j]!)) j++;
      if (!keep.symbols) blank(i + 1, j);
      i = j;
    } else i++;
  }
  return out.join('');
}

function lineOf(text: string, index: number): number { return text.slice(0, index).split('\n').length; }
function esc(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Body of `~hook = [~hook <>] { ... }` by brace matching, on stripped code. */
function hookBody(code: string, hook: string): { body: string; line: number; start: number; end: number } | null {
  const m = new RegExp(`${esc(hook)}\\b\\s*=[^{;]*\\{`).exec(code);
  if (!m) return null;
  let depth = 1, j = m.index + m[0].length;
  const start = j;
  while (j < code.length && depth > 0) { if (code[j] === '{') depth++; else if (code[j] === '}') depth--; j++; }
  return { body: code.slice(start, j - 1), line: lineOf(code, m.index), start, end: j - 1 };
}

/** Index just past the `)` that closes the `(` at `open`, on stripped code. */
function closeParen(code: string, open: number): number {
  let depth = 0, j = open;
  for (; j < code.length; j++) {
    if (code[j] === '(') depth++;
    else if (code[j] === ')' && --depth === 0) return j + 1;
  }
  return j;
}

function walk(dir: string, plugins: boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (plugins || e.name !== 'SC3plugins') walk(p, plugins, out); }
    else if (e.name.endsWith('.sc') && !e.name.startsWith('._')) out.push(p);
  }
  return out;
}

const classCache = new Map<string, Set<string>>();

/** Every class the installed SuperCollider can compile: what a patch may reference on THIS machine. */
export function knownClasses(dirs: string[] = CLASS_DIRS, plugins = true): Set<string> {
  const key = `${plugins}|${dirs.join('|')}`;
  const cached = classCache.get(key);
  if (cached) return cached;
  const names = new Set<string>();
  for (const dir of dirs) for (const f of walk(dir, plugins)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/^([A-Z]\w*)\s*(?:\[[^\]\n]*\])?\s*(?::\s*[A-Z]\w*\s*)?\{/gm)) names.add(m[1]!);
  }
  classCache.set(key, names);
  return names;
}

/** SynthDef names with their lines; `text` must have comments stripped but symbols/strings kept. */
function synthDefsIn(text: string): { name: string; line: number }[] {
  return [...text.matchAll(/SynthDef(?:\.new)?\(\s*(?:\\(\w+)|'([^']+)'|"([^"]+)")/g)]
    .map((m) => ({ name: (m[1] ?? m[2] ?? m[3])!, line: lineOf(text, m.index!) }));
}

function synthDefsInFile(path: string): string[] {
  return synthDefsIn(stripNonCode(readFileSync(path, 'utf8'), { symbols: true, strings: true })).map((d) => d.name);
}

// "Reads the partner" = reads its gesture data: ~partner.env / ~partner.sensors, directly, through
// `~partner !? { |p| p.env … }`, or through a variable assigned from ~partner. A mention of
// ~partner only to post whether a two-hand load happened (COS_Template) is not a read.
function readsPartnerData(code: string): boolean {
  const field = '\\s*\\.\\s*(?:env|sensors)\\b';
  if (new RegExp(`~partner${field}`).test(code)) return true;
  for (const m of code.matchAll(/~partner\s*!\?\s*\{\s*\|\s*(\w+)\s*\|/g)) {
    let depth = 1, j = m.index! + m[0].length;
    const start = j;
    while (j < code.length && depth > 0) { if (code[j] === '{') depth++; else if (code[j] === '}') depth--; j++; }
    if (new RegExp(`\\b${m[1]}${field}`).test(code.slice(start, j))) return true;
  }
  for (const m of code.matchAll(/\b(\w+)\s*=\s*~partner\b(?!\s*\.)/g)) {
    if (new RegExp(`\\b${m[1]}${field}`).test(code.slice(m.index! + m[0].length))) return true;
  }
  return false;
}

// --- the linter ------------------------------------------------------------------------------

export function lint(path: string, opts: LintOptions = {}): Issue[] {
  const abs = resolve(path);
  const rel = relative(repoRoot(), abs);
  const file = opts.file ?? (rel.startsWith('..') || isAbsolute(rel) ? abs : rel);
  return lintSource(basename(abs, '.sc'), readFileSync(abs, 'utf8'), { ...opts, file });
}

export function lintSource(name: string, src: string, opts: LintOptions = {}): Issue[] {
  const profile = opts.profile ?? loadProfile();
  const file = opts.file ?? `${name}.sc`;
  const code = stripNonCode(src); // comments, strings and symbols blanked
  const codeSym = stripNonCode(src, { symbols: true }); // symbols kept
  const codeStr = stripNonCode(src, { symbols: true, strings: true }); // only comments blanked
  const lines = src.split('\n');
  const issues: Issue[] = [];
  const add = (id: string, severity: Severity, line: number, message: string) => issues.push({ id, severity, file, line, message });
  const each = (id: string, severity: Severity, text: string, re: RegExp, message: string) => {
    const seen = new Set<number>();
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const l = lineOf(text, m.index!);
      if (!seen.has(l)) { seen.add(l); add(id, severity, l, message); }
    }
  };
  const defines = (hook: string) => new RegExp(`${esc(hook)}\\b\\s*=(?!=)`).test(code);

  // --- header ---
  const keys = new Map<string, { value: string; line: number }>();
  let h = 0; while (h < lines.length && lines[h]!.trim() === '') h++;
  if (!(lines[h] ?? '').trim().startsWith('/*')) add('header.missing-block', 'E', 1, 'File must start with a /* ... */ header block.');
  else {
    let e = h; while (e < lines.length && !lines[e]!.includes('*/')) e++;
    for (let k = h; k <= Math.min(e, lines.length - 1); k++) {
      const m = lines[k]!.replace(/^\s*\/\*/, '').replace(/\*\/\s*$/, '').match(/^\s*([a-zA-Z]+):\s*(.*)$/);
      if (m && !keys.has(m[1]!)) keys.set(m[1]!, { value: m[2]!.trim(), line: k + 1 });
    }
    for (const key of profile.headerKeys) {
      const sev: Severity = profile.optionalHeaderKeys.includes(key) ? 'W' : 'E';
      const got = keys.get(key);
      if (!got) add('header.keys', sev, h + 1, `Header is missing "${key}:".`);
      else if (got.value === '' || /^<.*>$/.test(got.value)) add('header.keys', sev, got.line, `"${key}:" is empty or still a template placeholder.`);
    }
    const g = keys.get('gestures');
    if (g) {
      const m = /^\[\s*([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*\]$/.exec(g.value);
      if (!m) add('header.gestures-grammar', 'E', g.line, `"gestures:" must be a bracketed list of lowercase words — got "${g.value}".`);
      else {
        const unknown = m[1]!.split(',').map((w) => w.trim()).filter((w) => !profile.gestureWords.includes(w));
        if (unknown.length) add('header.gestures-grammar', 'E', g.line, `Unknown gesture word(s) ${unknown.join(', ')} — use: ${profile.gestureWords.join(' ')}.`);
      }
    }
  }

  // --- name ---
  const is2H = name.endsWith('2H');
  if (!new RegExp(`^${esc(profile.prefix)}[A-Z][A-Za-z0-9]*$`).test(name)) add('name.cos-prefix', 'E', 1, `"${name}" must be ${profile.prefix}<UpperCamel>, letters and digits only.`);
  const partnerData = readsPartnerData(code);
  if (is2H && !partnerData) add('name.two-hand', 'E', 1, `"${name}" ends in 2H but never reads ~partner's env/sensors — drop the suffix or use the partner wrist.`);
  if (!is2H && partnerData) add('name.two-hand', 'E', lineOf(code, code.search(/~partner/)), `Reads ~partner's gesture data but "${name}" does not end in 2H — a one-hand slot always has ~partner nil.`);

  // --- hooks ---
  for (const hook of REQUIRED_HOOKS) if (!defines(hook)) add('hooks.required', 'E', 1, `Never defines "${hook} = ...".`);
  for (const hook of STATE_TICKS) {
    const at = new RegExp(`${esc(hook)}\\b\\s*=(?!=)`).exec(code);
    if (!at) add('state.idle-alias', 'W', 1, `Never defines "${hook}". The piece stays in \\idle, but never leave a state dead — alias it: ${hook} = ~idleNext;`);
    else if (!new RegExp(`${esc(hook)}\\b\\s*=\\s*~idleNext\\s*;`).test(code)) add('state.idle-alias', 'W', lineOf(code, at.index), `${hook} has its own body; the expected form is the alias ${hook} = ~idleNext;`);
  }
  for (const hook of ['~init', '~deinit']) {
    if (defines(hook) && !new RegExp(`${esc(hook)}\\b\\s*=\\s*${esc(hook)}\\s*<>`).test(code)) {
      add('style.compose', 'W', lineOf(code, code.search(new RegExp(`${esc(hook)}\\b\\s*=`))), `${hook} should compose: "${hook} = ${hook} <> { ... }", never clobber the controller's default.`);
    }
  }
  const room = hookBody(code, '~onRoomState');
  if (room && !/\\silent\b/.test(codeSym.slice(room.start, room.end))) {
    add('state.silent-unhandled', 'E', room.line, '~onRoomState has no \\silent branch — \\silent has no tick hook, it must be muted here.');
  }

  // --- scene params (ruling 6) ---
  const readsScene = /~sceneParams\b|\bcosSlotParams\b/.test(codeSym);
  const onScene = defines('~onSceneParams');
  if (readsScene && !onScene) {
    add('hooks.scene-params', 'E', lineOf(codeSym, codeSym.search(/~sceneParams\b|\bcosSlotParams\b/)), 'Reads scene params but never defines ~onSceneParams = { |p| ... } — a scene change after the load would be ignored.');
  }
  const params = keys.get('params');
  if (params && params.value !== '' && !/^none\b/i.test(params.value) && !/^<.*>$/.test(params.value)) {
    const declared: string[] = [];
    let depth = 0, piece = '';
    for (const ch of params.value + ',') {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { const k = /^\s*([A-Za-z_]\w*)/.exec(piece); if (k) declared.push(k[1]!); piece = ''; }
      else piece += ch;
    }
    if (!readsScene && !onScene) add('hooks.scene-params', 'W', params.line, `"params:" declares ${declared.join(', ')} but the patch never reads ~sceneParams / cosSlotParams.`);
    else for (const k of declared) {
      if (!new RegExp(`[\\\\.]${k}\\b|\\b${k}\\s*:`).test(codeSym)) add('hooks.scene-params', 'W', params.line, `"params:" declares "${k}" but nothing reads it (\\${k}, .${k}).`);
    }
  }

  // --- partner (engine §5.1) ---
  if (!is2H) {
    const deref = /~partner\s*(?:\.(?!\s*(?:notNil|isNil)\b)|\[)/.exec(code);
    if (deref) add('partner.guard', 'E', lineOf(code, deref.index), 'A one-hand patch dereferences ~partner — it is always nil outside a 2H load.');
  } else {
    // ~partner.env[\model], ~partner.env.at(\model), and ~partner.env !? { … } (which still
    // throws when ~partner itself is nil) all need a guard on ~partner in the same statement.
    // A read through the argument of ~partner !? { |p| p.env[\model] } never matches here.
    for (const m of code.matchAll(/~partner\s*\.\s*env\s*(?:(?:\[|\.\s*at\s*\()\s*\\|!\?)/g)) {
      if (!m[0].endsWith("!?")) {
        const after = codeSym.slice(m.index! + m[0].length - 1, m.index! + m[0].length + 8);
        if (!/^\\model\b/.test(after)) continue;
      }
      const start = code.lastIndexOf(';', m.index!) + 1;
      const endAt = code.indexOf(';', m.index!);
      const stmt = code.slice(start, endAt < 0 ? code.length : endAt);
      if (!/~partner\s*!\?\s*\{|~partner\s*\.\s*notNil\b|~partner\s*\?\?\s*\{/.test(stmt)) {
        add('partner.guard', 'E', lineOf(code, m.index!), 'Reads ~partner.env[\\model] without a nil guard — a tick can land before ~init sets ~partner (use ~partner !? { |p| ... } or if (~partner.notNil)).');
      }
    }
  }

  // --- tick-thread safety ---
  for (const hook of TICK_HOOKS) {
    const b = hookBody(code, hook);
    if (!b) continue;
    const blocking = /\bs\.sync\b|\.wait\b|\.yield\b|\bBuffer\.read|\bSynthDef\s*\(/.exec(b.body);
    if (blocking) add('tick.blocking', 'E', lineOf(code, b.start + blocking.index), `${hook} runs on the ~33 Hz AppClock tick: "${blocking[0].trim()}" does not belong there (move it to ~init).`);
    const post = /\.post(ln|f|cln)?\b|\bpostf\s*\(/.exec(b.body);
    if (post) add('tick.posting', 'W', lineOf(code, b.start + post.index), `${hook} posts — make sure it is only on change, a 33 Hz post floods the log.`);
  }

  // --- banned ---
  each('banned.outbus-rewire', 'E', code, /~outBus\s*=(?!=)/, '~outBus is read-only (var ob = ~outBus ? 0).');
  each('banned.server-control', 'E', code,
    /\bs\.(boot|quit|reboot|freeAll)\b|thisProcess\.recompile|\b0\.exit\b|Server\.(killAll|quitAll)|Server\.default\s*=(?!=)|CmdPeriod\.run|\bs\.defaultGroup\.freeAll/,
    'A personality never controls the server or frees nodes it does not own.');
  each('banned.global-write', 'E', code,
    /topEnvironment\s*(?:\[[^\]\n]*\]\s*=(?!=)|\.\s*(?:put|removeAt)\s*\()|~cos\w*\s*(?:\[[^\]\n]*\])?\s*=(?!=)|~cos\w*\s*\.\s*(?:put|removeAt)\s*\(|~devices\s*(?:\[[^\]\n]*\])?\s*=(?!=)|~devices\s*\.\s*(?:put|add|removeAt|remove|clear)\s*\(/,
    'Do not write engine globals (topEnvironment[...], ~cos…, ~devices) — they belong to the engine and every other slot.');
  each('banned.abs-path', 'E', codeStr, /["'](\/Users\/|\/Volumes\/|\/home\/|~\/)/,
    `No machine-specific path literals. Samples resolve from topEnvironment[\\${profile.samplesVar}].`);

  // --- samples: every Buffer.read*/cueSoundFile path is built from the samples root ---
  // Traced one hop: the argument list mentions samplesVar itself, or names an identifier that was
  // assigned (earlier in the file) from an expression mentioning samplesVar.
  const samplesRe = new RegExp(`\\b${esc(profile.samplesVar)}\\b`);
  const assigns: { name: string; at: number; fromSamples: boolean }[] = [];
  for (const a of code.matchAll(/(?<![\w~.])([a-z_]\w*)\s*=(?!=)/g)) {
    let depth = 0, j = a.index! + a[0].length;
    for (; j < code.length; j++) {
      const ch = code[j];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") { if (depth === 0) break; depth--; }
      else if ((ch === ";" || ch === ",") && depth === 0) break;
    }
    assigns.push({ name: a[1]!, at: a.index!, fromSamples: samplesRe.test(codeSym.slice(a.index! + a[0].length, j)) });
  }
  for (const m of code.matchAll(/\bBuffer\s*\.\s*(read\w*|cueSoundFile)\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    const close = closeParen(code, open);
    const args = codeSym.slice(open, close);
    if (samplesRe.test(args)) continue;
    const idents = new Set([...code.slice(open, close).matchAll(/(?<![\w~.\\])([a-z_]\w*)\b/g)].map((x) => x[1]!));
    if (assigns.some((a) => a.at < m.index! && a.fromSamples && idents.has(a.name))) continue;
    const literal = /^\(\s*[^,]*,\s*"/.test(codeStr.slice(open, close));
    add('sample.manifest', 'E', lineOf(code, m.index!), literal
      ? `Buffer.${m[1]} with a literal path — load from topEnvironment[\\${profile.samplesVar}] +/+ "<Name>/wav/<slot>.wav" (samples/<Name>/manifest.json).`
      : `Buffer.${m[1]} path must be built from topEnvironment[\\${profile.samplesVar}] (or ~${profile.samplesVar}) in the same expression or one assignment away.`);
  }

  // --- buses (Glimmer; both warn-only here) ---
  const busVars = [...code.matchAll(/(\w+)\s*=\s*Bus\.(audio|control)\s*\(/g)];
  for (const bm of busVars) {
    const l = lineOf(code, bm.index!);
    if (!new RegExp(`\\b${bm[1]}\\b[^;\\n]*\\.free\\b`).test(code.slice(bm.index! + bm[0].length))) add('bus.unfreed', 'W', l, `Bus "${bm[1]}" is allocated but never freed — free it in ~deinit, after the nodes that use it.`);
    else add('bus.private', 'W', l, 'Private Bus: for an in-patch effect send only, freed in ~deinit. Output still goes to the captured ~outBus.');
  }
  if (!busVars.length && /\bBus\.(audio|control)\s*\(/.test(code)) add('bus.unfreed', 'W', lineOf(code, code.search(/\bBus\.(audio|control)\s*\(/)), 'Bus allocated without keeping a reference — it can never be freed.');

  // --- SynthDef names are global to the whole AirKit process ---
  const mine = synthDefsIn(codeStr);
  const firstSeen = new Set<string>();
  for (const d of mine) {
    if (firstSeen.has(d.name)) add('synthdef.duplicate', 'E', d.line, `SynthDef \\${d.name} is defined twice in this file.`);
    firstSeen.add(d.name);
  }
  const others = new Map<string, string>();
  for (const n of ENGINE_SYNTHDEFS) others.set(n, 'the engine');
  const engineDir = join(dirname(profile.personalities), 'code3.0', 'conditions');
  if (existsSync(engineDir)) {
    for (const f of readdirSync(engineDir)) if (f.endsWith('.scd')) for (const n of synthDefsInFile(join(engineDir, f))) if (!others.has(n)) others.set(n, 'the engine');
  }
  if (existsSync(profile.personalities)) {
    for (const f of readdirSync(profile.personalities)) {
      if (!f.endsWith('.sc') || f === `${name}.sc`) continue;
      for (const n of synthDefsInFile(join(profile.personalities, f))) if (!others.has(n)) others.set(n, f);
    }
  }
  const prefixRe = new RegExp(`^${esc(profile.synthdefPrefix)}[A-Z0-9]`);
  const reported = new Set<string>();
  for (const d of mine) {
    if (reported.has(d.name)) continue;
    reported.add(d.name);
    if (!prefixRe.test(d.name)) add('synthdef.prefix', 'E', d.line, `SynthDef \\${d.name}: prefix it ${profile.synthdefPrefix}<Name>… (e.g. \\${profile.synthdefPrefix}${name.replace(profile.prefix, '')}Voice) so it can never collide.`);
    if (others.has(d.name)) add('synthdef.collision', 'E', d.line, `SynthDef \\${d.name} is also defined by ${others.get(d.name)} — SynthDef names are global, last load wins for every slot.`);
  }
  // stripNonCode keeps the backslash of a symbol and blanks its name, so `Pdef(\name` reads `Pdef(\    `.
  each('pdef.literal-name', 'W', code, /\b(Pdef|Pdefn|Ndef|Tdef)\s*\(\s*\\/, 'A literal Pdef/Ndef/Tdef key is shared by every slot running this patch — key it per device (e.g. with m.ptn).');

  // --- classes this machine cannot compile (hallucinated UGens, missing plugins) ---
  const classes = knownClasses(opts.classDirs ?? CLASS_DIRS, profile.plugins);
  if (classes.size < MIN_LIBRARY_CLASSES) add('class.library-not-found', 'W', 1, 'SuperCollider class library not found — unknown-class check skipped.');
  else {
    const seen = new Set<string>();
    for (const m of code.matchAll(/(?<![\w~\\.])([A-Z][A-Za-z0-9_]*)\b/g)) {
      const cls = m[1]!;
      if (seen.has(cls) || classes.has(cls)) continue;
      seen.add(cls);
      add('class.unknown', 'E', lineOf(code, m.index!), `"${cls}" is not a class in this machine's SuperCollider (SCClassLibrary + Extensions) — it would fail every load with "Class not defined".`);
    }
  }

  // --- roster and size ---
  if (!existsSync(profile.roster)) add('roster.missing', 'W', 1, `Roster ${profile.roster} not found.`);
  else if (!stripNonCode(readFileSync(profile.roster, 'utf8'), { strings: true, symbols: true }).includes(`"${name}"`)) {
    add('roster.missing', 'W', 1, `"${name}" is not in ${relative(repoRoot(), profile.roster)} — add it with npm run patch:roster -- add ${name}.`);
  }
  if (Buffer.byteLength(src, 'utf8') > MAX_SIZE_BYTES) add('size.too-large', 'W', 1, `File is over ${MAX_SIZE_BYTES} bytes.`);

  return issues.sort((a, b) => a.line - b.line);
}

export function formatIssue(i: Issue): string {
  return `[${i.severity}] ${i.id} — ${i.file}:${i.line} — ${i.message}`;
}
