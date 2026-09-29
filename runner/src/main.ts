// The composition root: reads cast.yaml and the scenes file, wires engine link, show, stick ingest,
// pedal and web server together, and reloads the two files when they change. Wiring only.
// Run directly (`node runner/src/main.ts`, run.sh's runner loop) or call main() in-process (tests, dev-fake).
import { existsSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Log } from './log.ts';
import { StateStore } from './state.ts';
import { AirkitLink } from './airkit.ts';
import { Show } from './show.ts';
import { StickIngest } from './sticks.ts';
import { Replay } from './replay.ts';
import { startPedal } from './pedal.ts';
import { startServer, type Command } from './server.ts';
import { buildView } from './view.ts';
import { parseCast, assignStickInFile, DEFAULT_CAST, type Cast } from './cast.ts';
import { parseScenes, parseRosterFile, slotsOf, AUDITION_SLOT, type Wrist } from './scenes.ts';

export interface MainOptions {
  repoRoot: string; scenesPath: string; castPath: string; statePath: string;
  airkitHost: string; airkitPort: number; sourcePort: number; stickPort: number; webPort: number;
  publicDir: string; log?: Log;
}
export interface Running { close(): Promise<void>; show: Show; webPort: number; stickPort: number }

const WATCH_DEBOUNCE_MS = 200;

/** The directory holding airkit.lock above runner/src/ (same discovery as scripts/setup.ts). */
export function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'airkit.lock'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('airkit.lock not found above runner/src/; set COS_REPO_ROOT');
}

const readOrNull = (path: string): string | null => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
function envPort(name: string): number | undefined {
  const v = process.env[name]; if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`${name}=${v} is not a port number`);
  return n;
}
function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return 'localhost';
}
/** `unusable`: the file could not be read or is not YAML at all, so `cast` is only the defaults. */
function readCast(text: string | null, path: string): { cast: Cast; error: string | null; unusable: boolean } {
  if (text === null) return { cast: structuredClone(DEFAULT_CAST), error: `cannot read ${path}`, unusable: true };
  const r = parseCast(text);
  return { cast: r.cast, error: r.errors.length ? r.errors.join('\n') : null, unusable: r.errors.some((e) => e.startsWith('yaml:')) };
}

export async function main(overrides: Partial<MainOptions> = {}): Promise<Running> {
  const log = overrides.log ?? new Log();
  const repoRoot = overrides.repoRoot ?? (process.env.COS_REPO_ROOT ? resolve(process.env.COS_REPO_ROOT) : findRepoRoot());
  const scenesPath = overrides.scenesPath ?? join(repoRoot, 'scenes', 'conditions.yaml');
  const castPath = overrides.castPath ?? join(repoRoot, 'scenes', 'cast.yaml');
  const publicDir = overrides.publicDir ?? join(repoRoot, 'runner', 'public');

  // cast.yaml: the getters below read `cast` live, so a reload is just a reassignment.
  let castText = readOrNull(castPath);
  let { cast, error: castError } = readCast(castText, castPath);
  if (castError) log.line(`cast.yaml: ${castError}${castText === null ? '; defaults used' : ''}`, 'error');
  const net = cast.network;
  const statePath = overrides.statePath ?? process.env.COS_STATE_PATH ?? join(repoRoot, 'runner', 'state', 'current.json');
  const airkitHost = overrides.airkitHost ?? process.env.COS_AIRKIT_HOST ?? net.airkitHost;
  const airkitPort = overrides.airkitPort ?? envPort('COS_LANGPORT') ?? net.airkitPort;
  const sourcePort = overrides.sourcePort ?? envPort('COS_SOURCE_PORT') ?? net.sourcePort;
  const stickPort = overrides.stickPort ?? envPort('COS_STICK_PORT') ?? net.stickPort;
  const webPort = overrides.webPort ?? envPort('COS_WEB_PORT') ?? net.webPort;

  // Roster: the shipped list until the engine answers, then the engine's own.
  const rosterPath = join(repoRoot, 'airkit', 'lists', 'list_conditions.sc');
  const rosterText = readOrNull(rosterPath);
  const fileRoster = rosterText === null ? null : parseRosterFile(rosterText);
  let scenesText = readOrNull(scenesPath);
  const parseScenesText = (text: string | null, roster: string[] | null) => (text === null ? { file: null, errors: [`cannot read ${scenesPath}`] } : parseScenes(text, roster));
  const first = parseScenesText(scenesText, fileRoster);
  let validatedRoster = JSON.stringify(fileRoster);

  const store = new StateStore(statePath);
  const airkit = new AirkitLink({ host: airkitHost, port: airkitPort, sourcePort, log: (m) => log.line(m) });
  const liveRoster = (): string[] | null => (airkit.online && airkit.roster.length ? airkit.roster : fileRoster);
  const show = new Show({ scenes: first.file?.scenes ?? [], airkit, cast: () => cast, store, log: (m, l) => log.line(m, l) });
  if (!first.file) { show.scenesError = first.errors.join('\n'); log.line(`scenes file: ${show.scenesError}`, 'error'); }

  // One IMU path for real sticks and replayed takes; a replayed wrist mutes its real stick meanwhile.
  const forwardImu = (w: Wrist, floats: number[]) => { for (const s of slotsOf(w)) airkit.forwardImu(s, floats); if (show.auditionWrist === w) airkit.forwardImu(AUDITION_SLOT, floats); };
  const replay = new Replay({ takesDir: join(repoRoot, 'takes'), onImu: forwardImu, log: (m, l) => log.line(m, l) });
  const sticks = new StickIngest({
    port: stickPort, cast: () => cast, log: (m) => log.line(m),
    onImu: (w, floats) => { if (!replay.active(w)) forwardImu(w, floats); },
    onAux: (w, kind, args) => { for (const s of slotsOf(w)) airkit.forwardAux(s, kind, args); if (show.auditionWrist === w) airkit.forwardAux(AUDITION_SLOT, kind, args); },
  });
  const pedal = await startPedal({
    cast: () => cast, log: (m) => log.line(m),
    onCue: (a) => { show[a]('pedal').catch((e: unknown) => log.line(`pedal ${a} failed: ${String(e)}`, 'error')); },
  });

  // --- file reloads (watcher and assignStick) ---
  const reloadCast = (): void => {
    const text = readOrNull(castPath);
    if (text === castText) return;
    castText = text;
    const r = readCast(text, castPath);
    castError = r.error;
    // A file that cannot be read or parsed keeps the previous cast: a mid-show typo must not unmap every stick.
    if (r.unusable) log.line(`cast.yaml unusable — keeping the previous cast: ${castError}`, 'error');
    else {
      cast = r.cast;
      if (castError) log.line(`cast.yaml reloaded with errors: ${castError}`, 'error');
      else log.line('cast.yaml reloaded');
    }
    server.broadcast();
  };
  const reloadScenes = async (force: boolean): Promise<void> => {
    const text = readOrNull(scenesPath);
    const textChanged = text !== scenesText;
    if (!force && !textChanged) return;
    const roster = liveRoster(); validatedRoster = JSON.stringify(roster);
    const r = parseScenesText(text, roster);
    if (r.file) {
      const hadError = show.scenesError !== null;
      show.scenesError = null;
      // Same text, already loaded: a re-validation that passes has nothing to replace.
      if (textChanged || hadError) {
        try { await show.replaceScenes(r.file.scenes); }
        catch (e) {   // scenesText stays old, so saving the same text again retries
          show.scenesError = `reload failed: ${e instanceof Error ? e.message : String(e)}`;
          log.line(`scenes file: ${show.scenesError}`, 'error'); server.broadcast();
          return;
        }
      }
      scenesText = text;
      log.line(`scenes file: ${r.file.scenes.length} scenes${textChanged || hadError ? '' : ', valid against the engine roster'}`);
    } else {
      scenesText = text;
      show.scenesError = r.errors.join('\n');
      log.line(`scenes file has errors — keeping the previous ${show.scenes.length} scenes:\n${show.scenesError}`, 'error');
      server.broadcast();
    }
  };
  let reloading: Promise<void> = Promise.resolve();   // one reload at a time, in order
  const queueReload = (forceScenes: boolean) => {
    reloading = reloading.then(async () => { reloadCast(); await reloadScenes(forceScenes); })
      .catch((e: unknown) => log.line(`reload failed: ${e instanceof Error ? e.message : String(e)}`, 'error'));
    return reloading;
  };

  const onCommand = async (c: Command, source: 'page' | 'admin'): Promise<void> => {
    switch (c.type) {
      case 'cue': await show[c.action](source); return;
      case 'jump': await show.jump(c.index, 'admin'); return;
      case 'trim': show.setTrim(c.wrist, c.db); return;
      case 'master': show.setMaster(c.db); return;
      case 'panic': show.panic(); return;
      case 'resume': await show.resume(); return;
      case 'audition': show.audition(c.wrist, c.patch); return;
      case 'reload': show.reloadWrist(c.wrist); return;
      case 'replay': replay.play(c.label, c.wrist, c.loop); return;
      case 'replayStop': replay.stop(); return;
      case 'assignStick': {
        const tmp = `${castPath}.tmp`;
        writeFileSync(tmp, assignStickInFile(readOrNull(castPath) ?? '', c.wrist, c.id, c.label));
        renameSync(tmp, castPath);
        log.line(`cast.yaml: ${c.wrist} ← stick ${c.id ?? 'none'}${c.label !== undefined ? ` (${c.label})` : ''}`);
        await queueReload(false);   // the watcher would too; this makes the ack mean "applied"
        return;
      }
    }
  };
  const server = await startServer({
    port: webPort, publicDir, log, onCommand,
    view: () => buildView({ show, sticks, airkit, replay, pedal: pedal.status, castError: () => castError }),
  }).catch((e: unknown) => { pedal.close(); sticks.close(); airkit.close(); replay.dispose(); throw e; });
  show.on('change', () => server.broadcast());
  replay.on('change', () => server.broadcast());
  airkit.on('online', () => {
    if (show.scenesError !== null || JSON.stringify(liveRoster()) !== validatedRoster) void queueReload(true);
  });

  // Watch the directories (editors replace files by rename, which a file watch would lose).
  const names = new Set([basename(scenesPath), basename(castPath)]);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const watchers: FSWatcher[] = [];
  for (const dir of new Set([dirname(scenesPath), dirname(castPath)])) {
    try {
      watchers.push(watch(dir, (_ev, file) => {
        if (file !== null && !names.has(String(file))) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => { debounce = null; void queueReload(false); }, WATCH_DEBOUNCE_MS);
      }).on('error', (e) => log.line(`[watch] ${dir}: ${e.message}`, 'warn')));
    } catch (e) { log.line(`[watch] cannot watch ${dir}: ${e instanceof Error ? e.message : String(e)} — edits need a restart`, 'warn'); }
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return; closed = true;
    if (debounce) clearTimeout(debounce);
    for (const w of watchers) w.close();
    await reloading;   // let an in-flight reload finish against live objects
    server.close(); sticks.close(); pedal.close(); replay.dispose(); show.dispose(); airkit.close();
  };

  try {
    await airkit.start();
    await show.boot();
    const boundStickPort = await sticks.start();
    const ip = lanIp();
    log.line(`[runner] Perform  http://${ip}:${server.port}/perform`);
    log.line(`[runner] Admin    http://${ip}:${server.port}/admin`);
    log.line(`[runner] sticks → udp ${ip}:${boundStickPort}    engine ${airkitHost}:${airkitPort}    source port ${airkit.portOf(1)}`);
    return { close, show, webPort: server.port, stickPort: boundStickPort };
  } catch (e) {
    await close();
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((r) => {
    const stop = () => { void r.close().finally(() => process.exit(0)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }, (e: unknown) => {
    console.error(`[runner] failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
