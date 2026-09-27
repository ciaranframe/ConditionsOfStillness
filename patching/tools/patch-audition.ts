// CLI for the audition tool (src/audition.ts). Plays a patch on the engine's audition slot 9
// through a private device (source port --src, device port src + 8) and reports levels per phase.
//
// Usage: node patching/tools/patch-audition.ts <Name> [--engine auto|running|boot]
//          [--quick|--long|--take <label>] [--params k=v,...] [--src 9101] [--keep]
// --engine auto (default): the running engine on 57120 if it answers getStatus within 1 s, else a
// private boot on 57130/57131 (log ~/.conditions/audition.log), killed on exit unless --keep.
// Exit 0 AUDITION PASS, 1 FAIL, 2 could not run / usage.
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bootEngine, killEngine, probeEngine, runAudition, type BootedEngine } from './src/audition.ts';
import { longPhases, quickPhases, syntheticPhases, takePhases, type Phase } from './src/phases.ts';
import { repoRoot } from './src/sc.ts';
import { encodeMessage } from '../../scripts/lib/osc.ts';

const USAGE = 'usage: patch-audition.ts <Name> [--engine auto|running|boot] [--quick|--long|--take <label>] [--params k=v,...] [--src 9101] [--keep]';
const HOST = '127.0.0.1';
const RUNNING_PORT = 57120;
const BOOT_LANG = 57130, BOOT_SCSYNTH = 57131;

function usage(msg: string): never {
  console.error(`patch-audition: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}

const argv = process.argv.slice(2);
let engineMode = 'auto';
let phaseMode: 'synthetic' | 'quick' | 'long' | 'take' = 'synthetic';
let takeLabel = '';
let paramsArg = '';
let src = 9101;
let keep = false;
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  switch (a) {
    case '--engine': engineMode = argv[++i] ?? ''; break;
    case '--quick': phaseMode = 'quick'; break;
    case '--long': phaseMode = 'long'; break;
    case '--take': phaseMode = 'take'; takeLabel = argv[++i] ?? ''; break;
    case '--params': paramsArg = argv[++i] ?? ''; break;
    case '--src': src = Number(argv[++i]); break;
    case '--keep': keep = true; break;
    default:
      if (a.startsWith('--')) usage(`unknown option ${a}`);
      positional.push(a);
  }
}
if (positional.length !== 1) usage('expected exactly one <Name>');
const patch = positional[0]!;
if (!['auto', 'running', 'boot'].includes(engineMode)) usage('--engine must be auto, running or boot');
if (!Number.isInteger(src) || src < 1024 || src > 65535 - 8) usage('--src must be a port number');
if (src + 8 >= 9001 && src <= 9009) usage('--src must keep the device ports clear of the runner\'s 9001–9009');
if (phaseMode === 'take' && !takeLabel) usage('--take needs a <label>');

const params: Record<string, string | number> = {};
if (paramsArg) {
  for (const kv of paramsArg.split(',')) {
    const eq = kv.indexOf('=');
    if (eq <= 0) usage(`--params entry "${kv}" is not k=v`);
    const k = kv.slice(0, eq).trim(), v = kv.slice(eq + 1).trim();
    params[k] = v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
  }
}

let phases: Phase[];
if (phaseMode === 'quick') phases = quickPhases();
else if (phaseMode === 'long') phases = longPhases();
else if (phaseMode === 'take') {
  const path = join(repoRoot(), 'takes', `${takeLabel}.take.jsonl`);
  if (!existsSync(path)) usage(`no take at ${path}`);
  phases = takePhases(readFileSync(path, 'utf8').split('\n'));
  if (phases.length === 0) usage(`take ${path} has no usable rows`);
} else phases = syntheticPhases();

let engine: BootedEngine | null = null;
let port = RUNNING_PORT;
let engineLog: string | undefined = join(homedir(), '.conditions', 'airkit.log');
let code = 2;
// The load this run actually sent (engine port, device port), set by runAudition's onLoaded.
let loadedAt: { enginePort: number; devicePort: number } | null = null;
// Ctrl-C/SIGTERM: if a load went out, silence that device on the engine it went to (never a
// guess at 57120); kill a private engine whenever one was spawned, even mid-boot.
let signalled = false;
const onSignal = () => {
  if (signalled) return;
  signalled = true;
  void (async () => {
    if (loadedAt) {
      const sock = createSocket('udp4');
      try {
        sock.send(encodeMessage('/airkit/loadPersonality', [loadedAt.devicePort, 0], 'ii'), loadedAt.enginePort, HOST);
        sock.send(encodeMessage('/airkit/cos/level', ['audition', 1, 0.1], 'sff'), loadedAt.enginePort, HOST);
        await new Promise<void>((r) => setTimeout(r, 100));
      } finally { sock.close(); }
    }
    if (engine && !keep) await killEngine(engine);
    process.exit(130);
  })();
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

try {
  let useRunning = false;
  if (engineMode !== 'boot') useRunning = await probeEngine(HOST, RUNNING_PORT, 1000);
  if (engineMode === 'running' && !useRunning) {
    console.error(`patch-audition: no engine answered getStatus on ${HOST}:${RUNNING_PORT} within 1 s`);
  } else {
    if (useRunning) {
      console.log(`[audition] using the running engine on ${RUNNING_PORT}`);
    } else {
      engine = await bootEngine({ langPort: BOOT_LANG, scsynthPort: BOOT_SCSYNTH, log: (m) => console.log(m), onSpawn: (e) => { engine = e; } });
      port = BOOT_LANG;
      engineLog = engine.logPath;
    }
    const t0 = Date.now();
    const result = await runAudition({
      host: HOST, port, srcPort: src, patch, phases, params, engineLog,
      onLoaded: (enginePort, devicePort) => { loadedAt = { enginePort, devicePort }; },
    });
    console.log('');
    for (const n of result.notes) console.log(`note: ${n}`);
    if (result.phases.length) console.log(result.table);
    if (result.errors.length) {
      console.log(`\nengine log errors (${engineLog}):`);
      for (const l of result.errors.slice(0, 20)) console.log(`  ${l}`);
    }
    console.log(`\n${result.outcome === 'pass' ? 'AUDITION PASS' : result.outcome === 'fail' ? 'AUDITION FAIL' : 'AUDITION COULD NOT RUN'}` +
      `${result.reason ? ` — ${result.reason}` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    code = result.outcome === 'pass' ? 0 : result.outcome === 'fail' ? 1 : 2;
  }
} catch (e) {
  console.error(`patch-audition: ${(e as Error).message}`);
  code = 2;
} finally {
  if (engine) {
    if (keep) console.log(`[audition] --keep: engine left running on ${engine.langPort}/${engine.scsynthPort} (pid ${engine.child.pid})`);
    else await killEngine(engine);
  }
}
process.exit(code);
