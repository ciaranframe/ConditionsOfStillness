import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Wrist = 'ZL' | 'ZR' | 'CL' | 'CR';
export interface PersistedState {
  sceneIndex: number;                 // -1 = STANDBY
  trims: Record<Wrist, number>;       // dB, Admin faders
  masterDb: number;
  panicked: boolean;                  // a restart inside the restore window comes back silent
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
      return { ...s, panicked: s.panicked === true };   // files written before the field existed: not panicked
    } catch { return null; }
  }
  save(s: PersistedState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
    renameSync(tmp, this.path);
  }
}
