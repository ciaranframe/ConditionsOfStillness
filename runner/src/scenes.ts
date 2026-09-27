// The scenes file: parse, validate, resolve one full sound-per-wrist table per scene. Pure.
import { parse as parseYaml } from 'yaml';

export type Wrist = 'ZL' | 'ZR' | 'CL' | 'CR';
export type Performer = 'Z' | 'C';
export type ParamValue = string | number;
export interface Sound { patch: string; params: Record<string, ParamValue>; level: number; partner: Wrist | null }
export interface Scene { index: number; id: string; name: string; fade: number; sounds: Record<Wrist, Sound>; mentions: Wrist[] }
export interface ScenesFile { piece: string; defaults: { fade: number; level: number }; scenes: Scene[] }

export const WRISTS: readonly Wrist[] = ['ZL', 'ZR', 'CL', 'CR'];
export const PERFORMERS: readonly Performer[] = ['Z', 'C'];
export const SILENCE: Sound = Object.freeze({ patch: 'silence', params: {}, level: 0, partner: null }) as Sound;
export const STANDBY_INDEX = -1;
export const AUDITION_SLOT = 9;
export const FADE_MIN = 0.05, FADE_MAX = 30;

export const slotsOf = (w: Wrist): [number, number] => ({ ZL: [1, 2], ZR: [3, 4], CL: [5, 6], CR: [7, 8] } as const)[w].slice() as [number, number];
export const leftOf = (p: Performer): Wrist => (p === 'Z' ? 'ZL' : 'CL');
export const rightOf = (p: Performer): Wrist => (p === 'Z' ? 'ZR' : 'CR');
export const isTwoHand = (patch: string) => patch.endsWith('2H');

export function standbyScene(): Scene {
  return { index: STANDBY_INDEX, id: 'STANDBY', name: 'Standby', fade: 2, sounds: { ZL: SILENCE, ZR: SILENCE, CL: SILENCE, CR: SILENCE }, mentions: [] };
}

export function sameSound(a: Sound, b: Sound): boolean { return a.patch === b.patch && a.partner === b.partner; }
export function sameParams(a: Record<string, ParamValue>, b: Record<string, ParamValue>): boolean {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}
export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= -60) return 0;
  return Math.min(4, Math.max(0, Math.pow(10, db / 20)));
}

export function parseRosterFile(text: string): string[] {
  return [...text.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]!);
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function parseScenes(text: string, roster: string[] | null): { file: ScenesFile | null; errors: string[] } {
  const errors: string[] = [];
  let doc: unknown;
  try { doc = parseYaml(text); } catch (e) { return { file: null, errors: [`yaml: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`] }; }
  if (!isRecord(doc)) return { file: null, errors: ['yaml: top level must be a mapping'] };
  if (!Array.isArray(doc.scenes) || doc.scenes.length === 0) return { file: null, errors: ['scenes: must be a non-empty list'] };
  const d = isRecord(doc.defaults) ? doc.defaults : {};
  const defaults = { fade: typeof d.fade === 'number' ? d.fade : 2.0, level: typeof d.level === 'number' ? d.level : 0 };
  const known = roster ? new Set(roster) : null;
  const ids = new Set<string>();
  const scenes: Scene[] = [];
  let prev: Record<Wrist, Sound> = { ZL: SILENCE, ZR: SILENCE, CL: SILENCE, CR: SILENCE };

  const readSound = (where: string, raw: unknown): Sound | null => {
    let patch: unknown, params: unknown = {}, level: unknown = defaults.level;
    if (typeof raw === 'string') patch = raw;
    else if (isRecord(raw)) { patch = raw.patch; params = raw.params ?? {}; level = raw.level ?? defaults.level; }
    if (typeof patch !== 'string' || patch === '') { errors.push(`${where}: sound needs a patch name`); return null; }
    if (known && !known.has(patch)) errors.push(`${where}: unknown patch ${patch}`);
    if (!isRecord(params)) { errors.push(`${where}: params must be a mapping`); params = {}; }
    const clean: Record<string, ParamValue> = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) clean[k] = v;
      else errors.push(`${where}: param ${k} must be a string or number`);
    }
    if (typeof level !== 'number' || !Number.isFinite(level)) { errors.push(`${where}: level must be a number (dB)`); level = defaults.level; }
    return { patch, params: clean, level: level as number, partner: null };
  };

  doc.scenes.forEach((raw, i) => {
    const tag = isRecord(raw) && typeof raw.id === 'string' ? raw.id : `#${i + 1}`;
    if (!isRecord(raw)) { errors.push(`${tag}: scene must be a mapping`); return; }
    const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : '';
    if (!id) errors.push(`${tag}: id is required`);
    else if (ids.has(id)) errors.push(`duplicate id ${id}`);
    ids.add(id);
    const name = typeof raw.name === 'string' ? raw.name : id;
    let fade = typeof raw.fade === 'number' ? raw.fade : defaults.fade;
    if (fade < FADE_MIN || fade > FADE_MAX) { errors.push(`${tag}: fade ${fade} must be between ${FADE_MIN} and ${FADE_MAX} s`); fade = Math.min(FADE_MAX, Math.max(FADE_MIN, fade)); }
    const sounds: Record<Wrist, Sound> = { ...prev };
    const mentions: Wrist[] = [];
    const rawSounds = isRecord(raw.sounds) ? raw.sounds : {};
    for (const [key, val] of Object.entries(rawSounds)) {
      const where = `${tag}: ${key}`;
      if ((WRISTS as readonly string[]).includes(key)) {
        const s = readSound(where, val); if (!s) continue;
        if (isTwoHand(s.patch)) errors.push(`${where}: 2H patch ${s.patch} must be on Z or C`);
        sounds[key as Wrist] = s; mentions.push(key as Wrist);
      } else if ((PERFORMERS as readonly string[]).includes(key)) {
        const s = readSound(where, val); if (!s) continue;
        if (!isTwoHand(s.patch)) errors.push(`${where}: ${s.patch} is not a 2H patch (Z and C take two-hand sounds only)`);
        const l = leftOf(key as Performer), r = rightOf(key as Performer);
        sounds[l] = { ...s, partner: r }; sounds[r] = SILENCE; mentions.push(l, r);
      } else errors.push(`${where}: unknown key (use ZL ZR CL CR or Z C)`);
    }
    scenes.push({ index: i, id, name, fade, sounds, mentions });
    prev = sounds;
  });
  return errors.length ? { file: null, errors } : { file: { piece: typeof doc.piece === 'string' ? doc.piece : '', defaults, scenes }, errors };
}
