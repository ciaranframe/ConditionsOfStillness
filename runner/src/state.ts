import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Wrist = 'ZL' | 'ZR' | 'CL' | 'CR';
export interface PersistedState {
  sceneIndex: number;                 // -1 = STANDBY
  trims: Record<Wrist, number>;       // dB, Admin faders
  masterDb: number;
  panicked: boolean;                  // a restart inside the restore window comes back silent
  liveSlots: Record<Wrist, 0 | 1>;    // each crossfader's slot index, so a restart re-pushes onto the slot that holds the sound
  savedAt: number;                    // Date.now()
}

/** runner/state/current.json, written atomically (temp + rename) on every change. */
export class StateStore {
  private path: string;
  constructor(path: string) { this.path = path; }
  load(): PersistedState | null {
    if (!existsSync(this.path)) return null;
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as PersistedState;
      if (typeof s.sceneIndex !== 'number' || typeof s.savedAt !== 'number' || !s.trims) return null;
      // Files written before these fields existed: not panicked, every crossfader on slot index 0.
      const ls = (s.liveSlots ?? {}) as Partial<Record<Wrist, unknown>>;
      const liveSlots = Object.fromEntries((['ZL', 'ZR', 'CL', 'CR'] as const).map((w) => [w, ls[w] === 1 ? 1 : 0])) as Record<Wrist, 0 | 1>;
      return { ...s, panicked: s.panicked === true, liveSlots };
    } catch { return null; }
  }
  save(s: PersistedState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    renameSync(tmp, this.path);
  }
}
