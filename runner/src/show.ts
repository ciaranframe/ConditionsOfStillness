// The show: scene state, one runtime record per wrist, cues → crossfades. Owns every timer.
// Spec §5 (load and fade sequence), §5.1 (engine facts), §6 (state); plan rulings 1–4.
import { EventEmitter } from 'node:events';
import { WRISTS, SILENCE, STANDBY_INDEX, standbyScene, sameSound, sameParams, dbToGain, slotsOf, type Scene, type Sound, type Wrist } from './scenes.ts';
import type { Cast } from './cast.ts';
import type { AirkitLink } from './airkit.ts';
import type { StateStore } from './state.ts';
import { monotonicMs } from './clock.ts';

export type CueSource = 'pedal' | 'key' | 'page' | 'admin' | 'scenes-file' | 'boot';
export type CueResult = 'done' | 'superseded' | 'noop';
export interface WristRuntime {
  liveSlot: 0 | 1;                         // index into slotsOf(w): the slot the crossfader is on (or heading to)
  live: Sound;                             // the sound on that slot
  standby: Sound | null;                   // the sound on the other slot; null = silence / free
  standbyReady: boolean;
  fade: { from: Sound; startedAt: number; seconds: number } | null;
  loading: boolean;                        // a cue is waiting for this wrist's incoming sound to be ready
  unloadTimer: ReturnType<typeof setTimeout> | null;
}
export interface LastCue { action: 'next' | 'back' | 'jump'; source: CueSource; at: number; targetId: string }
export interface ShowOptions {
  scenes: Scene[]; airkit: AirkitLink; cast: () => Cast; store: StateStore;
  clock?: () => number; log?: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  readyTimeoutMs?: number;    // 2000 (ruling 4)
  finishFadeSec?: number;     // 0.1 (spec §5, press mid-fade)
  unloadGraceMs?: number;     // 50: unload the outgoing slot this long after the fade ends
  restoreWindowMs?: number;   // 15 * 60 * 1000 (ruling 2)
  wallClock?: () => number;   // Date.now, for savedAt
}

const other = (i: 0 | 1): 0 | 1 => (i === 0 ? 1 : 0);
const freshRuntime = (): WristRuntime => ({ liveSlot: 0, live: SILENCE, standby: null, standbyReady: true, fade: null, loading: false, unloadTimer: null });

export class Show extends EventEmitter {
  scenes: Scene[];
  sceneIndex = STANDBY_INDEX;
  wrists: Record<Wrist, WristRuntime> = { ZL: freshRuntime(), ZR: freshRuntime(), CL: freshRuntime(), CR: freshRuntime() };
  trims: Record<Wrist, number> = { ZL: 0, ZR: 0, CL: 0, CR: 0 };
  masterDb = 0;
  lastCue: LastCue | null = null;
  panicked = false;
  scenesError: string | null = null;
  auditionState: { wrist: Wrist; patch: string } | null = null;

  private cueSeq = 0;
  private airkit: AirkitLink;
  private cast: () => Cast;
  private store: StateStore;
  private clock: () => number;
  private wall: () => number;
  private log: (m: string, l?: 'info' | 'warn' | 'error') => void;
  private readyTimeoutMs: number;
  private finishFadeSec: number;
  private unloadGraceMs: number;
  private restoreWindowMs: number;

  constructor(opts: ShowOptions) {
    super();
    this.scenes = opts.scenes;
    this.airkit = opts.airkit;
    this.cast = opts.cast;
    this.store = opts.store;
    this.clock = opts.clock ?? monotonicMs;
    this.wall = opts.wallClock ?? Date.now;
    this.log = opts.log ?? ((m, l) => console.log(`${l ?? 'info'} ${m}`));
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 2000;
    this.finishFadeSec = opts.finishFadeSec ?? 0.1;
    this.unloadGraceMs = opts.unloadGraceMs ?? 50;
    this.restoreWindowMs = opts.restoreWindowMs ?? 15 * 60 * 1000;
  }

  sceneAt(i: number): Scene { return i < 0 ? standbyScene() : this.scenes[i]!; }
  get current(): Scene { return this.sceneAt(this.sceneIndex); }
  get nextScene(): Scene | null { return this.sceneIndex + 1 < this.scenes.length ? this.scenes[this.sceneIndex + 1]! : null; }
  get prevScene(): Scene | null { return this.sceneIndex >= 0 ? this.sceneAt(this.sceneIndex - 1) : null; }
  labelOf(w: Wrist): string { return this.cast().sticks[w].label; }
  gainFor(w: Wrist, s: Sound): number { return dbToGain(s.level + this.trims[w]); }
  fadeProgress(w: Wrist): number | null {
    const f = this.wrists[w].fade;
    return f ? Math.min(1, (this.clock() - f.startedAt) / 1000 / f.seconds) : null;
  }
  private changed() { this.emit('change'); }
  persist(): void { this.store.save({ sceneIndex: this.sceneIndex, trims: { ...this.trims }, masterDb: this.masterDb, savedAt: this.wall() }); }

  next(source: CueSource): Promise<CueResult> { return this.goTo(this.sceneIndex + 1, source, 'next'); }
  back(source: CueSource): Promise<CueResult> { return this.goTo(this.sceneIndex - 1, source, 'back'); }
  jump(index: number, source: CueSource): Promise<CueResult> { return this.goTo(index, source, 'jump'); }

  private targetSlotFor(w: Wrist, desired: Sound): 0 | 1 { const rt = this.wrists[w]; return sameSound(rt.live, desired) ? rt.liveSlot : other(rt.liveSlot); }
  private partnerSlotFor(desired: Sound, scene: Scene): number | null {
    if (!desired.partner) return null;
    return slotsOf(desired.partner)[this.targetSlotFor(desired.partner, scene.sounds[desired.partner])];
  }

  private unloadOutgoing(w: Wrist) {
    const rt = this.wrists[w]; const slot = slotsOf(w)[other(rt.liveSlot)];
    this.airkit.params(slot, {}); this.airkit.partner(slot, null); this.airkit.load(slot, 'silence');
    rt.standby = null; rt.standbyReady = true;
  }
  // Synchronous on purpose: the new cue's load lands on this same slot, and a delayed unload would clobber it.
  private finishFadeNow(w: Wrist) {
    const rt = this.wrists[w]; if (!rt.fade) return;
    this.airkit.xfade(w, rt.liveSlot, this.finishFadeSec);
    if (rt.unloadTimer) clearTimeout(rt.unloadTimer);
    rt.unloadTimer = null; rt.fade = null;
    this.unloadOutgoing(w);
    this.log(`${this.labelOf(w)}: fade finished early (${this.finishFadeSec} s) for a new cue`);
  }

  async goTo(index: number, source: CueSource, action: 'next' | 'back' | 'jump' = 'jump'): Promise<CueResult> {
    // 1. bounds, bookkeeping
    if (index < STANDBY_INDEX || index >= this.scenes.length) return 'noop';
    const seq = ++this.cueSeq;
    const target = this.sceneAt(index);
    this.sceneIndex = index; this.lastCue = { action, source, at: this.clock(), targetId: target.id }; this.panicked = false;
    this.log(`cue ${action} → ${target.id} ${target.name} (fade ${target.fade}) [${source}]`);
    this.persist(); this.changed();

    // 2. plan
    type Kind = 'keep' | 'live' | 'xfade';
    const plan = {} as Record<Wrist, { kind: Kind; desired: Sound; targetSlotIdx: 0 | 1 }>;
    for (const w of WRISTS) {
      const rt = this.wrists[w]; const desired = target.sounds[w];
      if (rt.fade) this.finishFadeNow(w);
      rt.loading = false;
      let kind: Kind = 'xfade';
      if (sameSound(rt.live, desired)) kind = sameParams(rt.live.params, desired.params) && rt.live.level === desired.level ? 'keep' : 'live';
      plan[w] = { kind, desired, targetSlotIdx: kind === 'xfade' ? other(rt.liveSlot) : rt.liveSlot };
    }

    // 3. sends
    const waits: Array<Promise<boolean>> = []; const waiting: Wrist[] = [];
    for (const w of WRISTS) {
      const { kind, desired, targetSlotIdx } = plan[w]; const rt = this.wrists[w];
      if (kind === 'live') {
        if (!sameParams(rt.live.params, desired.params)) this.airkit.params(slotsOf(w)[rt.liveSlot], desired.params);
        if (rt.live.level !== desired.level) this.airkit.level(w, this.gainFor(w, desired), target.fade);
        rt.live = desired;
        this.log(`${this.labelOf(w)}: live change on ${desired.patch}`);
      } else if (kind === 'xfade') {
        const slot = slotsOf(w)[targetSlotIdx];
        const partnerSlot = desired.partner ? slotsOf(desired.partner)[plan[desired.partner].targetSlotIdx] : null;
        if (rt.standby && sameSound(rt.standby, desired)) {
          if (!sameParams(rt.standby.params, desired.params)) this.airkit.params(slot, desired.params);
          this.airkit.partner(slot, partnerSlot);                    // idempotent; always re-sent
          rt.standby = desired;
          this.log(`${this.labelOf(w)}: slot ${slot} already holds ${desired.patch}`);
        } else {
          this.airkit.params(slot, desired.params); this.airkit.partner(slot, partnerSlot);
          this.airkit.load(slot, desired.patch);
          rt.standby = desired; rt.standbyReady = false;
          this.log(`${this.labelOf(w)}: load slot ${slot} ← ${desired.patch}`);
        }
        rt.loading = true; waiting.push(w);
        waits.push(this.airkit.waitReady(slot, desired.patch, this.readyTimeoutMs));
      }
    }
    this.changed();

    // 4. wait for ready (ruling 4: at most readyTimeoutMs, then fade anyway)
    const ready = await Promise.all(waits);
    if (seq !== this.cueSeq) return 'superseded';
    ready.forEach((ok, i) => {
      const w = waiting[i]!;
      if (!ok) this.log(`${this.labelOf(w)}: ${plan[w].desired.patch} not ready after ${this.readyTimeoutMs} ms — fading anyway`, 'warn');
    });

    // 5. fire every fade in the same tick
    const now = this.clock();
    for (const w of waiting) {
      const rt = this.wrists[w]; const { desired, targetSlotIdx } = plan[w];
      rt.loading = false; rt.fade = { from: rt.live, startedAt: now, seconds: target.fade };
      rt.standby = rt.live; rt.standbyReady = true; rt.live = desired; rt.liveSlot = targetSlotIdx;
      this.airkit.level(w, this.gainFor(w, desired), target.fade);
      this.airkit.xfade(w, targetSlotIdx, target.fade);
      this.log(`${this.labelOf(w)}: xfade slot ${slotsOf(w)[other(targetSlotIdx)]} → ${slotsOf(w)[targetSlotIdx]}, ${rt.fade.from.patch} → ${desired.patch}, ${target.fade} s`);
      const timer = setTimeout(() => {
        if (rt.unloadTimer === timer) rt.unloadTimer = null;
        if (!rt.fade || rt.fade.startedAt !== now) return;
        rt.fade = null; this.unloadOutgoing(w); this.preloadNext(); this.changed();
      }, target.fade * 1000 + this.unloadGraceMs);
      timer.unref();
      rt.unloadTimer = timer;
    }
    if (waiting.length === 0) this.preloadNext();
    this.changed();
    return 'done';
  }

  preloadNext(): void {
    const n = this.nextScene; if (!n) return;
    for (const w of WRISTS) {
      const rt = this.wrists[w]; if (rt.fade || rt.loading) continue;
      const desired = n.sounds[w];
      if (sameSound(rt.live, desired)) continue;                               // a live change needs no preload
      if (rt.standby === null && desired.patch === 'silence') continue;
      if (rt.standby && sameSound(rt.standby, desired)) continue;
      const slot = slotsOf(w)[other(rt.liveSlot)];
      this.airkit.params(slot, desired.params); this.airkit.partner(slot, this.partnerSlotFor(desired, n));
      this.airkit.load(slot, desired.patch);
      rt.standby = desired.patch === 'silence' ? null : desired; rt.standbyReady = false;   // null = silence / free
      this.log(`${this.labelOf(w)}: preload slot ${slot} ← ${desired.patch}`);
    }
  }

  // Task 7 replaces this with the restore-or-standby version; for now boot = pushAll when online.
  async boot(): Promise<void> {
    for (const w of WRISTS) this.wrists[w] = { ...freshRuntime(), live: this.current.sounds[w] };
    this.airkit.on('online', () => { void this.pushAll(); });
    if (this.airkit.online) await this.pushAll();
    this.changed();
  }

  // Spec §5.1 re-push order: master → per-wrist level and xfade → params and partner for every slot → loads.
  async pushAll(): Promise<void> {
    this.log('re-pushing everything to the engine');
    for (const w of WRISTS) {
      const rt = this.wrists[w];
      if (rt.unloadTimer) clearTimeout(rt.unloadTimer);
      rt.unloadTimer = null; rt.fade = null; rt.loading = false; rt.standby = null; rt.standbyReady = true;
    }
    if (!(await this.airkit.ensureDevices())) this.log('some engine devices are missing; loads will be refused until they appear', 'warn');
    const scene = this.current;
    this.airkit.master(dbToGain(this.masterDb), 0.1);
    for (const w of WRISTS) { const rt = this.wrists[w]; this.airkit.level(w, this.gainFor(w, rt.live), 0.1); this.airkit.xfade(w, rt.liveSlot, 0.1); }
    for (const w of WRISTS) {
      const rt = this.wrists[w]; const live = slotsOf(w)[rt.liveSlot], free = slotsOf(w)[other(rt.liveSlot)];
      this.airkit.params(live, rt.live.params); this.airkit.partner(live, this.partnerSlotFor(rt.live, scene));
      this.airkit.params(free, {}); this.airkit.partner(free, null);
    }
    for (const w of WRISTS) {
      const rt = this.wrists[w];
      this.airkit.load(slotsOf(w)[rt.liveSlot], rt.live.patch);
      this.airkit.load(slotsOf(w)[other(rt.liveSlot)], 'silence');
    }
    this.preloadNext();
    this.changed();
  }

  dispose(): void {
    this.cueSeq++;                      // a cue still waiting for ready returns 'superseded' and schedules nothing
    for (const w of WRISTS) { const rt = this.wrists[w]; if (rt.unloadTimer) clearTimeout(rt.unloadTimer); rt.unloadTimer = null; }
  }
}
