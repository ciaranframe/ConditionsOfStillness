// Linter tests. Most fixtures are the template with one thing broken (inline, via `sub`, which
// fails loudly if the text it replaces is missing so a fixture can never silently lint the
// unmodified template); whole-file fixtures live in fixtures/lint/ where the CLI needs a path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatIssue, knownClasses, lint, lintSource, loadProfile, type Issue } from '../src/lint.ts';
import { personalityPath, repoRoot } from '../src/sc.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'lint');
const CLI = join(HERE, '..', 'patch-lint.ts');
const TEMPLATE = readFileSync(personalityPath('COS_Template'), 'utf8');
// The template under a fixture name, its SynthDef renamed so it does not collide with the real
// COS_Template.sc in airkit/personalities/.
const BASE = TEMPLATE.replaceAll('cosTemplateVoice', 'cosFixtureVoice').replaceAll('[COS_Template]', '[COS_Fixture]');

const INIT = '\n~init = ~init <> { |d|\n'; // the code line, not the header comment that quotes it

function sub(src: string, from: string, to: string): string {
  assert.ok(src.includes(from), `fixture text not found: ${JSON.stringify(from)}`);
  return src.replace(from, to);
}
function fix(src: string, name = 'COS_Fixture'): Issue[] { return lintSource(name, src); }
function has(issues: Issue[], id: string, severity?: 'E' | 'W'): boolean {
  return issues.some((i) => i.id === id && (!severity || i.severity === severity));
}
function errors(issues: Issue[]): Issue[] { return issues.filter((i) => i.severity === 'E'); }
function fires(issues: Issue[], id: string, severity: 'E' | 'W'): void {
  assert.ok(has(issues, id, severity), `expected [${severity}] ${id}; got:\n${issues.map(formatIssue).join('\n')}`);
}
function quiet(issues: Issue[], id: string): void {
  assert.ok(!has(issues, id), `expected no ${id}; got:\n${issues.filter((i) => i.id === id).map(formatIssue).join('\n')}`);
}
function inTick(src: string, line: string): string { return sub(src, 'var e = track.();', `var e = track.();\n\t${line}`); }
function atTop(src: string, line: string): string { return sub(src, 'var register = \\mid;', `var register = \\mid;\n${line}`); }

const TWO_HAND_GUARDED = String.raw`
~idleNext = { |d, ctx|
	var e = track.();
	var pm = ~partner !? { |p| p.env[\model] };
	if (~partner.notNil) { var pe = ~partner.env[\model]; e = e + (pe !? { |x| x.accelMass } ? 0) };
	if (synth.notNil) { synth.set(\amp, e) };
};
`;

// --- the template --------------------------------------------------------------------------

test('COS_Template lints clean: no errors', () => {
  const issues = lint(personalityPath('COS_Template'));
  assert.deepEqual(errors(issues).map(formatIssue), []);
  // Warnings are allowed; there are none today — keep this list in the report if that changes.
  assert.deepEqual(issues.map(formatIssue), []);
});

test('the fixture base (template renamed) lints with no errors', () => {
  assert.deepEqual(errors(fix(BASE)).map(formatIssue), []);
});

// --- header --------------------------------------------------------------------------------

test('header.missing-block: file without a leading /* */ block', () => {
  fires(fix(BASE.slice(BASE.indexOf('*/') + 2)), 'header.missing-block', 'E');
});

test('header.keys: missing required key is E, missing optional key is W', () => {
  const noFamily = fix(sub(BASE, 'family:      template\n', ''));
  fires(noFamily, 'header.keys', 'E');
  const noResearch = fix(sub(BASE, 'research:    none — this is the skeleton\n', ''));
  fires(noResearch, 'header.keys', 'W');
  quiet(errors(noResearch), 'header.keys');
  fires(fix(sub(BASE, 'rhythm:      none — continuous, moves only with gesture', 'rhythm:      <rhythm>')), 'header.keys', 'E');
});

test('header.gestures-grammar: unbracketed list and unknown word', () => {
  fires(fix(sub(BASE, 'gestures:    [sway, shake, tilt]', 'gestures:    sway, shake')), 'header.gestures-grammar', 'E');
  fires(fix(sub(BASE, 'gestures:    [sway, shake, tilt]', 'gestures:    [sway, wiggle]')), 'header.gestures-grammar', 'E');
  quiet(fix(sub(BASE, 'gestures:    [sway, shake, tilt]', 'gestures:    [strike, stillness, roll]')), 'header.gestures-grammar');
});

// --- names ---------------------------------------------------------------------------------

test('name.cos-prefix: not COS_<UpperCamel>', () => {
  fires(fix(BASE, 'Fixture'), 'name.cos-prefix', 'E');
  fires(fix(BASE, 'COS_bad_name'), 'name.cos-prefix', 'E');
  quiet(fix(BASE, 'COS_Glass'), 'name.cos-prefix');
});

test('name.two-hand: 2H name without reading ~partner fails', () => {
  fires(fix(BASE, 'COS_Fixture2H'), 'name.two-hand', 'E');
});

test('name.two-hand: reading ~partner without the 2H suffix fails', () => {
  const src = sub(BASE, /~idleNext = \{[\s\S]*?\n\};\n/.exec(BASE)![0], TWO_HAND_GUARDED);
  fires(fix(src, 'COS_Fixture'), 'name.two-hand', 'E');
  quiet(fix(src, 'COS_Fixture2H'), 'name.two-hand');
});

// --- hooks and state -----------------------------------------------------------------------

test('hooks.required: each required hook missing', () => {
  fires(fix(sub(BASE, '~onRoomState = {', '~onRoomStateX = {')), 'hooks.required', 'E');
  fires(fix(sub(BASE, '~deinit = ~deinit <> {', '~deinitX = {')), 'hooks.required', 'E');
  const noIdle = sub(sub(sub(sub(BASE, '~idleNext = {', '~tickX = {'), '~tuningNext = ~idleNext;', ''), '~pieceNext = ~idleNext;', ''), '~curtainNext = ~idleNext;', '');
  fires(fix(noIdle), 'hooks.required', 'E');
});

test('state.idle-alias: a missing state tick, or one that is not an alias, warns', () => {
  fires(fix(sub(BASE, '~curtainNext = ~idleNext;', '')), 'state.idle-alias', 'W');
  fires(fix(sub(BASE, '~pieceNext = ~idleNext;', '~pieceNext = { |d, ctx| };')), 'state.idle-alias', 'W');
});

test('state.silent-unhandled: ~onRoomState without a \\silent branch', () => {
  fires(fix(sub(BASE, '\\silent, { if (synth.notNil)', '\\idle, { if (synth.notNil)')), 'state.silent-unhandled', 'E');
});

test('hooks.scene-params: reads scene params without ~onSceneParams is E', () => {
  fires(fix(sub(BASE, '~onSceneParams = { |p| applyParams.(p) };', '')), 'hooks.scene-params', 'E');
});

test('hooks.scene-params: a declared param nothing reads is W', () => {
  const src = sub(BASE, 'params:      register (low|mid|high, default mid)', 'params:      register (low|mid|high), density (0-1)');
  fires(fix(src), 'hooks.scene-params', 'W');
  quiet(fix(BASE), 'hooks.scene-params');
  quiet(fix(sub(BASE, 'params:      register (low|mid|high, default mid)', 'params:      none')), 'hooks.scene-params');
});

test('partner.guard: a one-hand patch dereferencing ~partner fails', () => {
  fires(fix(inTick(BASE, 'var pm = ~partner.env[\\model];')), 'partner.guard', 'E');
});

test('partner.guard: a 2H patch reading ~partner.env[\\model] unguarded fails; guarded forms pass', () => {
  const idle = /~idleNext = \{[\s\S]*?\n\};\n/.exec(BASE)![0];
  const unguarded = sub(BASE, idle, '~idleNext = { |d, ctx|\n\tvar pm = ~partner.env[\\model];\n\tvar q = ~partner.env.at(\\model);\n};\n');
  const got = fix(unguarded, 'COS_Fixture2H').filter((i) => i.id === 'partner.guard');
  assert.equal(got.length, 2, got.map(formatIssue).join('\n'));
  quiet(fix(sub(BASE, idle, TWO_HAND_GUARDED), 'COS_Fixture2H'), 'partner.guard');
  const nilDefault = sub(BASE, idle, '~idleNext = { |d, ctx|\n\tvar q = (~partner ?? { nil }) !? { ~partner.env[\\model] };\n};\n');
  quiet(fix(nilDefault, 'COS_Fixture2H'), 'partner.guard');
});

test('partner.guard: ~partner.env !? { … } alone is not a guard (it throws when ~partner is nil)', () => {
  const idle = /~idleNext = \{[\s\S]*?\n\};\n/.exec(BASE)![0];
  const envOnly = sub(BASE, idle, '~idleNext = { |d, ctx|\n\tvar pm = ~partner.env !? { |e| e[\\model] };\n};\n');
  fires(fix(envOnly, 'COS_Fixture2H'), 'partner.guard', 'E');
});

test('style.compose: ~init that clobbers instead of composing', () => {
  fires(fix(sub(BASE, INIT, '\n~init = { |d|\n')), 'style.compose', 'W');
});

// --- tick thread ---------------------------------------------------------------------------

test('tick.blocking: s.sync / .wait / Buffer.read / SynthDef inside a tick', () => {
  fires(fix(inTick(BASE, 's.sync;')), 'tick.blocking', 'E');
  fires(fix(inTick(BASE, '0.1.wait;')), 'tick.blocking', 'E');
});

test('tick.posting: .postln inside a tick warns', () => {
  fires(fix(inTick(BASE, 'e.postln;')), 'tick.posting', 'W');
  quiet(fix(BASE), 'tick.posting'); // the template posts from ~init, which is fine
});

// --- banned --------------------------------------------------------------------------------

test('banned.outbus-rewire', () => { fires(fix(atTop(BASE, '~outBus = 4;')), 'banned.outbus-rewire', 'E'); });

test('banned.server-control: s.boot and Server.default =', () => {
  fires(fix(atTop(BASE, 's.boot;')), 'banned.server-control', 'E');
  fires(fix(atTop(BASE, 'Server.default = Server.local;')), 'banned.server-control', 'E');
});

test('banned.global-write: topEnvironment[...] =, ~cos… =, ~devices', () => {
  fires(fix(atTop(BASE, 'topEnvironment[\\foo] = 1;')), 'banned.global-write', 'E');
  fires(fix(atTop(BASE, '~cosSlotParams = nil;')), 'banned.global-write', 'E');
  fires(fix(atTop(BASE, '~devices = nil;')), 'banned.global-write', 'E');
  fires(fix(atTop(BASE, 'topEnvironment.put(\\foo, 1);')), 'banned.global-write', 'E');
});

test('banned.abs-path: a machine-specific path literal', () => {
  fires(fix(atTop(BASE, 'var p = "/Users/me/x.wav";')), 'banned.abs-path', 'E');
});

// --- samples -------------------------------------------------------------------------------

test('sample.manifest: a literal Buffer.read path fails; one built from cosSamples passes', () => {
  const bad = fix(sub(BASE, INIT, INIT + '\tvar b = Buffer.read(s, "/Users/x.wav");\n'));
  fires(bad, 'sample.manifest', 'E');
  const good = fix(sub(BASE, INIT, INIT + '\tvar b = Buffer.read(s, topEnvironment[\\cosSamples] +/+ "hit.wav");\n'));
  quiet(good, 'sample.manifest');
  quiet(good, 'banned.abs-path');
  const env = fix(sub(BASE, INIT, INIT + '\tvar b = Buffer.readChannel(s, ~cosSamples +/+ "COS_Fixture/wav/hit.wav", channels: [0]);\n'));
  quiet(env, 'sample.manifest');
  fires(fix(sub(BASE, INIT, INIT + '\tvar b = Buffer.cueSoundFile(s, somePath, 0, 2);\n')), 'sample.manifest', 'E');
});

test('sample.manifest: a path traced one hop to cosSamples passes; one hop to a literal fails', () => {
  const viaVar = fix(sub(atTop(BASE, 'var dir = ~cosSamples +/+ "COS_Fixture/wav";'), INIT, INIT + '\tvar b = Buffer.read(s, dir +/+ "hit.wav");\n'));
  quiet(viaVar, 'sample.manifest');
  const viaTop = fix(sub(atTop(BASE, 'var dir;'), INIT, INIT + '\tvar b;\n\tdir = topEnvironment[\\cosSamples] +/+ "COS_Fixture";\n\tb = Buffer.read(s, dir +/+ "hit.wav");\n'));
  quiet(viaTop, 'sample.manifest');
  const literalVar = fix(sub(atTop(BASE, 'var dir = "/Users/x";'), INIT, INIT + '\tvar b = Buffer.read(s, dir +/+ "hit.wav");\n'));
  fires(literalVar, 'sample.manifest', 'E');
  const literal = fix(sub(BASE, INIT, INIT + '\tvar b = Buffer.read(s, "hit.wav");\n'));
  fires(literal, 'sample.manifest', 'E');
  const later = fix(sub(sub(BASE, INIT, INIT + '\tvar b = Buffer.read(s, dir +/+ "hit.wav");\n'), '~onSceneParams = {', 'var dir = ~cosSamples;\n~onSceneParams = {'));
  fires(later, 'sample.manifest', 'E'); // assigned only after the read
});

test('Review Focus 2: fixture file declaring samples: with a literal path fails via the CLI', () => {
  const r = spawnSync(process.execPath, [CLI, join(FIXTURES, 'COS_LiteralSample.sc')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^\[E\] sample\.manifest — .*COS_LiteralSample\.sc:\d+ — /m);
});

test('Review Focus 2: fixture file named 2H that never reads ~partner fails via the CLI', () => {
  const r = spawnSync(process.execPath, [CLI, join(FIXTURES, 'COS_Lonely2H.sc')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^\[E\] name\.two-hand — /m);
});

// --- buses ---------------------------------------------------------------------------------

test('bus.private and bus.unfreed warn', () => {
  const freed = sub(atTop(BASE, 'var fxBus = Bus.audio(s, 2);'), 'synth = nil;', 'synth = nil;\n\tfxBus.free;');
  fires(fix(freed), 'bus.private', 'W');
  quiet(fix(freed), 'bus.unfreed');
  fires(fix(atTop(BASE, 'var fxBus = Bus.audio(s, 2);')), 'bus.unfreed', 'W');
});

// --- SynthDefs and Pdefs -------------------------------------------------------------------

test('synthdef.prefix: a SynthDef without the cos prefix', () => {
  fires(fix(BASE.replaceAll('cosFixtureVoice', 'fixtureVoice')), 'synthdef.prefix', 'E');
  quiet(fix(BASE.replaceAll('cosFixtureVoice', 'cosSomethingElse')), 'synthdef.prefix');
});

test('synthdef.duplicate: the same name twice in one file', () => {
  fires(fix(atTop(BASE, 'SynthDef(\\cosFixtureVoice, { Out.ar(0, 0) }).add;')), 'synthdef.duplicate', 'E');
});

test('synthdef.collision: another personality\'s SynthDef and the engine\'s', () => {
  fires(fix(TEMPLATE.replaceAll('[COS_Template]', '[COS_Fixture]')), 'synthdef.collision', 'E'); // \cosTemplateVoice
  fires(fix(atTop(BASE, 'SynthDef(\\cosMaster, { Out.ar(0, 0) }).add;')), 'synthdef.collision', 'E');
  fires(fix(atTop(BASE, 'SynthDef(\\cosWristMonitor, { Out.ar(0, 0) }).add;')), 'synthdef.collision', 'E');
});

test('pdef.literal-name: a literal Pdef key warns', () => {
  fires(fix(atTop(BASE, 'Pdef(\\cosFixtureLoop, Pbind(\\dur, 1));')), 'pdef.literal-name', 'W');
});

// --- classes -------------------------------------------------------------------------------

test('class index: Quaternion (Extensions) and MdaPiano (SC3plugins) resolve; NoSuchUGen does not', () => {
  const classes = knownClasses();
  assert.ok(classes.size > 500, `only ${classes.size} classes indexed`);
  assert.ok(classes.has('Quaternion'));
  assert.ok(classes.has('MdaPiano'));
  assert.ok(classes.has('SinOsc'));
  assert.ok(!classes.has('NoSuchUGen'));
});

test('class.unknown: NoSuchUGen fails; MdaPiano passes', () => {
  fires(fix(inTick(BASE, 'var z = NoSuchUGen.ar(1);')), 'class.unknown', 'E');
  quiet(fix(atTop(BASE, 'SynthDef(\\cosFixturePiano, { Out.ar(0, MdaPiano.ar(440)) }).add;')), 'class.unknown');
});

test('class.library-not-found: no class library on the configured path warns and skips', () => {
  const empty = mkdtempSync(join(tmpdir(), 'cos-lint-classes-'));
  const issues = lintSource('COS_Fixture', inTick(BASE, 'var z = NoSuchUGen.ar(1);'), { classDirs: [empty] });
  fires(issues, 'class.library-not-found', 'W');
  quiet(issues, 'class.unknown');
});

// --- roster and size -----------------------------------------------------------------------

test('roster.missing: a patch not in the roster warns', () => {
  fires(fix(BASE, 'COS_NotInRoster'), 'roster.missing', 'W');
  quiet(lint(personalityPath('COS_Template')), 'roster.missing');
});

test('size.too-large: over 64 KB warns', () => {
  fires(fix(BASE + '// ' + 'x'.repeat(66 * 1024) + '\n'), 'size.too-large', 'W');
});

// --- profile -------------------------------------------------------------------------------

test('loadProfile reads the front-matter of patching/profile.md', () => {
  const p = loadProfile();
  assert.equal(p.prefix, 'COS_');
  assert.equal(p.synthdefPrefix, 'cos');
  assert.equal(p.samplesVar, 'cosSamples');
  assert.equal(p.roster, join(repoRoot(), 'airkit/lists/list_conditions.sc'));
  assert.deepEqual(p.optionalHeaderKeys, ['internals', 'research']);
  assert.ok(p.gestureWords.includes('stillness'));
});

test('--profile overrides the default profile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cos-lint-profile-'));
  const profile = join(dir, 'profile.md');
  const text = readFileSync(join(repoRoot(), 'patching', 'profile.md'), 'utf8').replace('prefix: COS_', 'prefix: XX_');
  writeFileSync(profile, text);
  const r = spawnSync(process.execPath, [CLI, 'COS_Template', '--json', '--profile', profile], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.ok((JSON.parse(r.stdout) as Issue[]).some((i) => i.id === 'name.cos-prefix'));
  const missing = spawnSync(process.execPath, [CLI, 'COS_Template', '--profile', join(dir, 'nope.md')], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
});

// --- CLI -----------------------------------------------------------------------------------

test('CLI: COS_Template by bare name exits 0', () => {
  const r = spawnSync(process.execPath, [CLI, 'COS_Template'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /^\[E\]/m);
});

test('CLI: --json prints an array of {id, severity, file, line, message}', () => {
  const r = spawnSync(process.execPath, [CLI, join(FIXTURES, 'COS_LiteralSample.sc'), '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  const arr = JSON.parse(r.stdout) as Issue[];
  assert.ok(Array.isArray(arr) && arr.length > 0);
  for (const i of arr) {
    assert.deepEqual(Object.keys(i).sort(), ['file', 'id', 'line', 'message', 'severity']);
    assert.ok(i.severity === 'E' || i.severity === 'W');
    assert.equal(typeof i.line, 'number');
  }
  const clean = spawnSync(process.execPath, [CLI, 'COS_Template', '--json'], { encoding: 'utf8' });
  assert.equal(clean.status, 0);
  assert.deepEqual(JSON.parse(clean.stdout), []);
});

test('CLI: exit 2 on usage error and on a missing file', () => {
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, 'COS_DoesNotExist'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, 'COS_Template', '--bogus'], { encoding: 'utf8' }).status, 2);
});
