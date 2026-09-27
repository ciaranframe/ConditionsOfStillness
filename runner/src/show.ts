// The show: scene state, one runtime record per wrist, cues → crossfades. Owns every timer.
// Spec §5 (load and fade sequence), §5.1 (engine facts), §6 (state); plan rulings 1–4.
import { EventEmitter } from 'node:events';
import { WRISTS, SILENCE, STANDBY_INDEX, AUDITION_SLOT, standbyScene, sameSound, sameParams, dbToGain, slotsOf, type Scene, type Sound, type Wrist } from './scenes.ts';
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
  private pushing = 0;                     // pushAll calls in progress: reconcile waits for them
  private attempts = new Map<number, { live: string; desired: string; count: number; gaveUp: boolean }>();   // slot → situation (idea from Glimmer's AirkitLink.reconcile)
  private onOnline = () => { void this.pushAll(); };
  private onSeats = (seats: Record<number, string>) => this.reconcile(seats);
  private loadedAtAsk = new Map<number, number>();   // slot → airkit.seatsAsked when we last loaded it
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

  // Every load goes through here so reconcile can tell a seats reply that predates it (asked before the load) from real drift.
  private load(slot: number, patch: string): void {
    this.loadedAtAsk.set(slot, this.airkit.seatsAsked);
    this.airkit.load(slot, patch);
  }

  private unloadOutgoing(w: Wrist) {
    const rt = this.wrists[w]; const slot = slotsOf(w)[other(rt.liveSlot)];
    this.airkit.params(slot, {}); this.airkit.partner(slot, null); this.load(slot, 'silence');
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
          this.load(slot, desired.patch);
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
      // a live change needs no preload; silence needs a free slot. Anything else left on standby is stale.
      const want = sameSound(rt.live, desired) || desired.patch === 'silence' ? null : desired;
      if (want === null) {
        if (rt.standby !== null) { this.log(`${this.labelOf(w)}: unload stale ${rt.standby.patch} from slot ${slotsOf(w)[other(rt.liveSlot)]}`); this.unloadOutgoing(w); }
        continue;
      }
      if (rt.standby && sameSound(rt.standby, want)) continue;
      const slot = slotsOf(w)[other(rt.liveSlot)];
      this.airkit.params(slot, desired.params); this.airkit.partner(slot, this.partnerSlotFor(desired, n));
      this.load(slot, desired.patch);
      rt.standby = desired.patch === 'silence' ? null : desired; rt.standbyReady = false;   // null = silence / free
      this.log(`${this.labelOf(w)}: preload slot ${slot} ← ${desired.patch}`);
    }
  }

  // Ruling 2: restore the scene only from a recent state; trims and master always come back.
  async boot(): Promise<void> {
    const s = this.store.load();
    if (s) {
      this.trims = { ...this.trims, ...s.trims };
      if (typeof s.masterDb === 'number') this.masterDb = s.masterDb;
      const age = this.wall() - s.savedAt;
      if (age < this.restoreWindowMs && s.sceneIndex >= STANDBY_INDEX && s.sceneIndex < this.scenes.length) {
        this.sceneIndex = s.sceneIndex;
        this.log(`restored scene ${this.current.id} (saved ${Math.round(age / 1000)} s ago)`);
      } else this.log('starting in STANDBY (no recent state)');
    } else this.log('starting in STANDBY');
    for (const w of WRISTS) this.wrists[w] = { ...freshRuntime(), live: this.current.sounds[w] };
    this.airkit.on('online', this.onOnline);
    this.airkit.on('seats', this.onSeats);
    if (this.airkit.online) await this.pushAll();
    this.changed();
  }

  // Supersede any waiting cue, drop every timer and fade, and land the model on the current scene
  // (on silence while panicked) with liveSlot kept. Returns the new cue sequence number.
  private resetForPush(): number {
    const seq = ++this.cueSeq;
    for (const w of WRISTS) {
      const rt = this.wrists[w];
      if (rt.unloadTimer) clearTimeout(rt.unloadTimer);
      rt.unloadTimer = null; rt.fade = null; rt.loading = false; rt.standby = null; rt.standbyReady = true;
      rt.live = this.panicked ? SILENCE : this.current.sounds[w];
    }
    this.attempts.clear();
    return seq;
  }

  // Spec §5.1 re-push order: master → per-wrist level and xfade → params and partner for every slot → loads.
  // Supersedes any cue still waiting for ready and lands the model on the current scene with no fade in flight.
  async pushAll(): Promise<void> {
    this.log('re-pushing everything to the engine');
    this.pushing++;
    try {
      const seq = this.resetForPush();
      if (!(await this.airkit.ensureDevices())) this.log('some engine devices are missing; loads will be retried as seats appear', 'warn');
      // A cue (or panic) that arrived during the device check would be clobbered by the loads below: re-plan on the newest target.
      if (seq !== this.cueSeq) { this.log('state changed during the device check — re-pushing the newest target'); this.resetForPush(); }
      const scene = this.current;
      this.airkit.master(dbToGain(this.masterDb), 0.1);
      for (const w of WRISTS) { const rt = this.wrists[w]; this.airkit.level(w, this.gainFor(w, rt.live), 0.1); this.airkit.xfade(w, rt.liveSlot, 0.1); }
      for (const w of WRISTS) {
        const rt = this.wrists[w]; const live = slotsOf(w)[rt.liveSlot], free = slotsOf(w)[other(rt.liveSlot)];
        this.airkit.params(live, rt.live.params); this.airkit.partner(live, this.partnerSlotFor(rt.live, scene));
        this.airkit.params(free, {}); this.airkit.partner(free, null);
      }
      this.airkit.params(AUDITION_SLOT, {}); this.airkit.partner(AUDITION_SLOT, null);
      for (const w of WRISTS) {
        const rt = this.wrists[w];
        this.load(slotsOf(w)[rt.liveSlot], rt.live.patch);
        this.load(slotsOf(w)[other(rt.liveSlot)], 'silence');
      }
      this.load(AUDITION_SLOT, this.auditionState?.patch ?? 'silence');
      if (this.auditionState) { this.airkit.audition(this.auditionState.wrist); this.airkit.level('audition', 1, 0.1); }
      if (!this.panicked) this.preloadNext();
      this.changed();
    } finally { this.pushing--; }
  }

  // What each slot should hold right now; wrists with a fade or a load in flight are left alone.
  private expectedSeats(): Map<number, { patch: string; sound: Sound | null; scene: Scene }> {
    const m = new Map<number, { patch: string; sound: Sound | null; scene: Scene }>();
    for (const w of WRISTS) {
      const rt = this.wrists[w]; if (rt.fade || rt.loading) continue;
      m.set(slotsOf(w)[rt.liveSlot], { patch: rt.live.patch, sound: rt.live, scene: this.current });
      m.set(slotsOf(w)[other(rt.liveSlot)], { patch: rt.standby?.patch ?? 'silence', sound: rt.standby, scene: this.nextScene ?? this.current });
    }
    m.set(AUDITION_SLOT, { patch: this.auditionState?.patch ?? 'silence', sound: null, scene: this.current });
    return m;
  }
  // Re-issue a load whose seat drifted: 3 attempts per (slot, live, desired) situation, then give up until it changes.
  reconcile(seats: Record<number, string>): void {
    if (this.panicked || this.pushing > 0) return;
    for (const [slot, want] of this.expectedSeats()) {
      const desired = want.patch;
      const live = seats[this.airkit.portOf(slot)];
      if (live === undefined || live === desired) { this.attempts.delete(slot); continue; }
      if (this.loadedAtAsk.get(slot) === this.airkit.seatsAsked) continue;   // no seats request since our last load: this reply predates it
      let a = this.attempts.get(slot);
      if (!a || a.live !== live || a.desired !== desired) { a = { live, desired, count: 0, gaveUp: false }; this.attempts.set(slot, a); }
      if (a.gaveUp) continue;
      a.count++;
      this.airkit.params(slot, want.sound?.params ?? {});
      this.airkit.partner(slot, want.sound ? this.partnerSlotFor(want.sound, want.scene) : null);
      this.load(slot, desired);
      this.log(`slot ${slot}: engine has ${live}, expected ${desired} — reloading (attempt ${a.count})`, 'warn');
      if (a.count >= 3) { a.gaveUp = true; this.log(`slot ${slot}: ${desired} not converging, giving up until the expectation changes`, 'error'); }
    }
  }

  // Spec §5.1: panic cancels every pending post-fade timer, or a stale one would load after the silence.
  panic(): void {
    for (const w of WRISTS) {
      const rt = this.wrists[w];
      if (rt.unloadTimer) clearTimeout(rt.unloadTimer);
      rt.unloadTimer = null; rt.fade = null; rt.loading = false; rt.live = SILENCE; rt.standby = null; rt.standbyReady = true;
    }
    this.cueSeq++;                      // any cue still waiting for ready is superseded
    this.auditionState = null; this.panicked = true;
    this.airkit.panic(); this.log('PANIC: every wrist silenced', 'error'); this.changed();
  }
  async resume(): Promise<void> {
    this.panicked = false;              // pushAll lands the model on the current scene
    this.log('resume: re-pushing the current scene');
    await this.pushAll();
    this.airkit.level('audition', 1, 0.1);
  }

  get auditionWrist(): Wrist | null { return this.auditionState?.wrist ?? null; }
  audition(wrist: Wrist, patch: string | null): void {
    this.airkit.params(AUDITION_SLOT, {}); this.airkit.partner(AUDITION_SLOT, null);
    if (patch) {
      this.auditionState = { wrist, patch };
      this.airkit.audition(wrist); this.load(AUDITION_SLOT, patch); this.airkit.level('audition', 1, 0.1);
      this.log(`audition ${patch} on ${this.labelOf(wrist)} (slot ${AUDITION_SLOT})`);
    } else {
      this.auditionState = null;
      this.airkit.audition(null); this.load(AUDITION_SLOT, 'silence');
      this.log('audition off');
    }
    this.changed();
  }
  // Rapid same-slot reload: silence then the live patch restarts it from scratch.
  reloadWrist(w: Wrist): void {
    const rt = this.wrists[w];
    if (rt.fade || rt.loading) { this.log(`${this.labelOf(w)}: reload skipped — a transition is in flight`, 'warn'); return; }
    const slot = slotsOf(w)[rt.liveSlot];
    this.airkit.params(slot, rt.live.params); this.airkit.partner(slot, this.partnerSlotFor(rt.live, this.current));
    this.load(slot, 'silence'); this.load(slot, rt.live.patch);
    this.log(`${this.labelOf(w)}: reload ${rt.live.patch} on slot ${slot}`); this.changed();
  }
  setTrim(w: Wrist, db: number): void {
    if (!Number.isFinite(db)) return;
    this.trims[w] = Math.max(-60, Math.min(12, db));
    this.airkit.level(w, this.gainFor(w, this.wrists[w].live), 0.1);
    this.persist(); this.changed();
  }
  setMaster(db: number): void {
    if (!Number.isFinite(db)) return;
    this.masterDb = Math.max(-60, Math.min(12, db));
    this.airkit.master(dbToGain(this.masterDb), 0.1);
    this.persist(); this.changed();
  }

  // Keep the current scene by id (re-cue it if its sounds changed), else STANDBY; then preload the new next.
  async replaceScenes(scenes: Scene[]): Promise<void> {
    const curId = this.sceneIndex >= 0 ? this.current.id : null;
    this.scenes = scenes;
    const idx = curId === null ? STANDBY_INDEX : scenes.findIndex((s) => s.id === curId);
    if (this.panicked) {                // a re-cue would un-panic and bring the sound back: only move the pointer
      this.sceneIndex = idx < 0 ? STANDBY_INDEX : idx;
      this.log('scenes file reloaded while panicked — not re-cued', 'warn');
      this.persist(); this.changed();
      return;
    }
    if (curId !== null && idx < 0) {
      this.log(`scenes file changed: current scene ${curId} is gone — STANDBY`, 'warn');
      await this.goTo(STANDBY_INDEX, 'scenes-file');
      return;
    }
    this.sceneIndex = idx;
    const target = this.sceneAt(idx);
    const differs = WRISTS.some((w) => {
      const live = this.wrists[w].live, want = target.sounds[w];
      return !sameSound(live, want) || !sameParams(live.params, want.params) || live.level !== want.level;
    });
    if (differs) { this.log('scenes file changed: current scene differs — re-cueing it'); await this.goTo(idx, 'scenes-file'); }
    else { this.log('scenes file reloaded'); this.preloadNext(); this.persist(); this.changed(); }
  }

  dispose(): void {
    this.airkit.off('online', this.onOnline);
    this.airkit.off('seats', this.onSeats);
    this.cueSeq++;                      // a cue still waiting for ready returns 'superseded' and schedules nothing
    for (const w of WRISTS) { const rt = this.wrists[w]; if (rt.unloadTimer) clearTimeout(rt.unloadTimer); rt.unloadTimer = null; }
  }
}
