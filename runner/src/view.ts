// The one JSON both pages render. Pure over its deps: it reads the show, the stick ingest,
// the engine link and the pedal, and never throws when any of them has nothing to say
// (engine offline, a wrist with no stick, an empty scene list).
import { WRISTS, AUDITION_SLOT, slotsOf, type Scene, type Wrist } from './scenes.ts';
import type { Show, LastCue } from './show.ts';
import type { StickIngest, HeardStick } from './sticks.ts';
import { BATTERY_LOW_PCT } from './sticks.ts';
import type { AirkitLink } from './airkit.ts';
import type { PedalStatus } from './pedal.ts';
import { whoOf, type Cast } from './cast.ts';
import { monotonicMs } from './clock.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'inert';
export interface StatusCell { key: 'PEDAL' | 'STICKS' | 'AIRKIT' | 'AUDIO' | 'BATTERY' | 'CPU'; value: string; tone: Tone }
export type WristState = 'OK' | 'FADING' | 'LOADING' | 'SILENT' | 'NO SIGNAL' | 'PANIC';
export interface WristView { wrist: Wrist; label: string; who: string; patch: string; incoming: string | null; state: WristState; fadePct: number | null; alive: boolean; ageMs: number; battery: number | null; ipMismatch: boolean; levelDb: number; trimDb: number; liveSlot: number; standbyPatch: string | null; peak: number; rms: number; detail: string }
export interface SceneView { index: number; id: string; name: string; fade: number; n: number; summary: string }   // summary: "fade 6.0 · A3 A4 B2" (labels of mentioned wrists, 'Zubin 2H' for a two-hand mention)
export interface View {
  t: number; standby: boolean; panicked: boolean; sceneIndex: number; sceneCount: number;
  scene: SceneView | null; next: SceneView | null; prev: SceneView | null; scenes: SceneView[];
  wrists: Record<Wrist, WristView>; status: StatusCell[];
  engine: { online: boolean; cpu: number; limiterOn: boolean; deviceCount: number; host: string; port: number; levelsAgeMs: number | null };
  slots: Array<{ slot: number; stick: string; name: string; tickAgeMs: number; ready: boolean; live: boolean }>;
  pedal: PedalStatus; heard: HeardStick[]; audition: { wrist: Wrist; patch: string } | null; lastCue: LastCue | null;
  scenesError: string | null; castError: string | null; masterDb: number; masterPeak: number; roster: string[];
}
export interface ViewDeps { show: Show; sticks: StickIngest; airkit: AirkitLink; pedal: () => PedalStatus; castError: () => string | null; clock?: () => number }

const LEVELS_FRESH_MS = 1500;
const BATTERY_BAD_PCT = 10;
const CPU_WARN = 70, CPU_BAD = 90;
const MINUS = '−';

/** Only the labels are read, so anything carrying `sticks[w].label` (a full Cast included) will do. */
export function summarize(scene: Scene, cast: Pick<Cast, 'sticks'>): string {
  const parts: string[] = [];
  const skip = new Set<Wrist>();
  for (const w of WRISTS) {
    if (!scene.mentions.includes(w) || skip.has(w)) continue;
    const partner = scene.sounds[w].partner;
    if (partner) { parts.push(`${w[0] === 'Z' ? 'Zubin' : 'Claire'} 2H`); skip.add(partner); }
    else parts.push(cast.sticks[w].label);
  }
  return `fade ${scene.fade.toFixed(1)} · ${parts.length ? parts.join(' ') : 'all'}`;
}

export function dbfs(linear: number): string {
  if (!(linear > 0)) return `${MINUS}inf`;
  const n = Math.round(20 * Math.log10(linear));
  return n < 0 ? `${MINUS}${-n} dB` : `${n} dB`;
}

const finiteOr = (x: number, fallback: number) => (Number.isFinite(x) ? Math.round(x) : fallback);

export function buildView(d: ViewDeps): View {
  const { show, sticks, airkit } = d;
  const now = (d.clock ?? monotonicMs)();
  const signals = sticks.wrists();
  const labels = { sticks: Object.fromEntries(WRISTS.map((w) => [w, { label: signals[w].label }])) as Record<Wrist, { label: string }> };
  const sceneView = (s: Scene | null): SceneView | null =>
    s ? { index: s.index, id: s.id, name: s.index < 0 ? '' : s.name, fade: s.fade, n: s.index + 1, summary: summarize(s, labels) } : null;

  const online = airkit.online;
  const status = online ? airkit.status : null;   // AirkitLink clears its status on going offline; the online check also covers the replies of a still-booting engine
  const levels = airkit.levels;
  const levelsAgeMs = levels ? Math.max(0, Math.round(now - levels.at)) : null;

  const wrists = {} as Record<Wrist, WristView>;
  for (const w of WRISTS) {
    const rt = show.wrists[w], sig = signals[w];
    const state: WristState = show.panicked ? 'PANIC' : !sig.alive ? 'NO SIGNAL' : rt.loading ? 'LOADING' : rt.fade ? 'FADING' : rt.live.patch === 'silence' ? 'SILENT' : 'OK';
    const liveSlot = slotsOf(w)[rt.liveSlot];
    const standbyPatch = rt.standby?.patch ?? null;
    const detail = [
      ...Object.entries(rt.live.params).map(([k, v]) => `${k}=${v}`),
      `slot ${liveSlot} live`,
      ...(standbyPatch && !rt.fade ? [`preload ${standbyPatch}`] : []),   // while fading, standby is the outgoing sound
    ];
    const lv = levels?.[w];
    wrists[w] = {
      wrist: w, label: sig.label, who: whoOf(w),
      patch: rt.fade ? rt.fade.from.patch : rt.live.patch, incoming: rt.fade ? rt.live.patch : null,
      state, fadePct: show.fadeProgress(w), alive: sig.alive, ageMs: finiteOr(sig.ageMs, -1), battery: sig.batteryPct, ipMismatch: sig.ipMismatch,
      levelDb: rt.live.level, trimDb: show.trims[w], liveSlot, standbyPatch,
      peak: lv?.[0] ?? 0, rms: lv?.[1] ?? 0, detail: detail.join(' · '),
    };
  }

  const cells: StatusCell[] = [];
  const pedal = d.pedal();
  cells.push({ key: 'PEDAL', value: pedal.state, tone: pedal.state === 'OK' ? 'ok' : 'warn' });
  const alive = WRISTS.filter((w) => signals[w].alive).length;
  cells.push({ key: 'STICKS', value: `${alive} / 4`, tone: alive === 4 ? 'ok' : alive > 0 ? 'warn' : 'bad' });
  cells.push({ key: 'AIRKIT', value: online ? 'OK' : 'OFFLINE', tone: online ? 'ok' : 'bad' });
  if (!online) cells.push({ key: 'AUDIO', value: 'OFFLINE', tone: 'bad' });
  else if (levelsAgeMs !== null && levelsAgeMs <= LEVELS_FRESH_MS) cells.push({ key: 'AUDIO', value: 'OK', tone: 'ok' });
  else cells.push({ key: 'AUDIO', value: 'NO METERS', tone: 'warn' });
  const known = WRISTS.filter((w) => signals[w].batteryPct !== null).sort((a, b) => signals[a].batteryPct! - signals[b].batteryPct!);
  const low = known[0];
  if (low === undefined) cells.push({ key: 'BATTERY', value: '—', tone: 'inert' });
  else {
    const pct = signals[low].batteryPct!;
    if (pct >= BATTERY_LOW_PCT) cells.push({ key: 'BATTERY', value: 'OK', tone: 'ok' });
    else cells.push({ key: 'BATTERY', value: `${signals[low].label} ${pct}%`, tone: pct < BATTERY_BAD_PCT ? 'bad' : 'warn' });
  }
  if (!status) cells.push({ key: 'CPU', value: '—', tone: 'inert' });
  else { const cpu = status.serverCpu; cells.push({ key: 'CPU', value: `${Math.round(cpu)}%`, tone: cpu < CPU_WARN ? 'ok' : cpu < CPU_BAD ? 'warn' : 'bad' }); }

  const slots: View['slots'] = [];
  for (let slot = 1; slot <= AUDITION_SLOT; slot++) {
    const w = WRISTS.find((x) => slotsOf(x).includes(slot)) ?? null;
    const s = status?.slots.find((x) => x.slot === slot);
    slots.push({
      slot, stick: w ? signals[w].label : 'aud', name: s?.name ?? '', tickAgeMs: s?.tickAgeMs ?? -1, ready: s?.ready ?? false,
      live: w ? slotsOf(w)[show.wrists[w].liveSlot] === slot : show.auditionState !== null,
    });
  }

  const idx = show.sceneIndex;
  return {
    t: Date.now(), standby: idx < 0, panicked: show.panicked, sceneIndex: idx, sceneCount: show.scenes.length,
    scene: idx >= 0 && idx < show.scenes.length ? sceneView(show.current) : null,
    next: sceneView(show.nextScene), prev: idx >= 0 && idx <= show.scenes.length ? sceneView(show.prevScene) : null,
    scenes: show.scenes.map((s) => sceneView(s)!),
    wrists, status: cells,
    engine: { online, cpu: status?.serverCpu ?? 0, limiterOn: !!status?.limiterOn, deviceCount: status?.deviceCount ?? 0, host: airkit.host, port: airkit.port, levelsAgeMs },
    slots, pedal, heard: sticks.heard(), audition: show.auditionState, lastCue: show.lastCue,
    scenesError: show.scenesError, castError: d.castError(), masterDb: show.masterDb, masterPeak: levels?.master[0] ?? 0, roster: airkit.roster,
  };
}
