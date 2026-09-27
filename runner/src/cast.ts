// scenes/cast.yaml: stick ids -> wrists, pedal mapping, ports. Pure parse; the file edit
// goes through the yaml Document API so comments survive an Admin-side assignment.
import { parseDocument, parse as parseYaml } from 'yaml';
import { WRISTS, type Wrist } from './scenes.ts';

export interface StickCast { id: string | null; label: string; ip: string | null }
export interface PedalTrigger { note?: number; cc?: number }
export interface Cast {
  sticks: Record<Wrist, StickCast>;
  pedal: { input: string | null; channel: number | null; next: PedalTrigger; back: PedalTrigger; debounceMs: number };
  network: { stickPort: number; webPort: number; airkitHost: string; airkitPort: number; sourcePort: number };
}

export const DEFAULT_CAST: Cast = {
  sticks: { ZL: { id: null, label: 'ZL', ip: null }, ZR: { id: null, label: 'ZR', ip: null }, CL: { id: null, label: 'CL', ip: null }, CR: { id: null, label: 'CR', ip: null } },
  pedal: { input: null, channel: null, next: { note: 60 }, back: { note: 62 }, debounceMs: 150 },
  network: { stickPort: 8000, webPort: 3000, airkitHost: '127.0.0.1', airkitPort: 57120, sourcePort: 9001 },
};

export const whoOf = (w: Wrist): string => `${w[0] === 'Z' ? 'Zubin' : 'Claire'} · ${w[1] === 'L' ? 'left' : 'right'}`;
export const wristOfStickId = (cast: Cast, id: string): Wrist | null => WRISTS.find((w) => cast.sticks[w].id === id) ?? null;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const idStr = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

function readTrigger(where: string, raw: unknown, fallback: PedalTrigger, errors: string[]): PedalTrigger {
  if (!isRecord(raw)) { errors.push(`${where}: expected { note: n } or { cc: n }`); return fallback; }
  if (Number.isInteger(raw.note)) return { note: raw.note as number };
  if (Number.isInteger(raw.cc)) return { cc: raw.cc as number };
  errors.push(`${where}: note or cc must be an integer`); return fallback;
}

export function parseCast(text: string): { cast: Cast; errors: string[] } {
  const errors: string[] = [];
  let doc: unknown;
  try { doc = parseYaml(text); } catch (e) { return { cast: structuredClone(DEFAULT_CAST), errors: [`yaml: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`] }; }
  const root = isRecord(doc) ? doc : {};
  const cast = structuredClone(DEFAULT_CAST);
  const sticks = isRecord(root.sticks) ? root.sticks : {};
  for (const w of WRISTS) {
    const s = sticks[w];
    if (s === undefined) continue;
    if (!isRecord(s)) { errors.push(`sticks.${w}: expected a mapping`); continue; }
    cast.sticks[w] = { id: idStr(s.id), label: typeof s.label === 'string' && s.label ? s.label : w, ip: idStr(s.ip) };
  }
  for (let i = 0; i < WRISTS.length; i++) for (let j = i + 1; j < WRISTS.length; j++) {
    const a = cast.sticks[WRISTS[i]!].id, b = cast.sticks[WRISTS[j]!].id;
    if (a !== null && a === b) errors.push(`sticks: id ${a} is used by both ${WRISTS[i]} and ${WRISTS[j]}`);
  }
  const pedal = isRecord(root.pedal) ? root.pedal : {};
  if (pedal.input !== undefined) cast.pedal.input = pedal.input === null ? null : String(pedal.input);
  if (pedal.channel !== undefined) cast.pedal.channel = pedal.channel === null ? null : Number(pedal.channel);
  if (pedal.next !== undefined) cast.pedal.next = readTrigger('pedal.next', pedal.next, cast.pedal.next, errors);
  if (pedal.back !== undefined) cast.pedal.back = readTrigger('pedal.back', pedal.back, cast.pedal.back, errors);
  if (typeof pedal.debounceMs === 'number') cast.pedal.debounceMs = pedal.debounceMs;
  const net = isRecord(root.network) ? root.network : {};
  for (const k of ['stickPort', 'webPort', 'airkitPort', 'sourcePort'] as const) {
    if (net[k] === undefined) continue;
    if (Number.isInteger(net[k]) && (net[k] as number) > 0 && (net[k] as number) < 65536) cast.network[k] = net[k] as number;
    else errors.push(`network.${k}: must be a port number`);
  }
  if (typeof net.airkitHost === 'string') cast.network.airkitHost = net.airkitHost;
  return { cast, errors };
}

export function assignStickInFile(text: string, wrist: Wrist, id: string | null, label?: string, ip?: string | null): string {
  const doc = parseDocument(text);
  if (!doc.hasIn(['sticks'])) doc.setIn(['sticks'], {});
  doc.setIn(['sticks', wrist, 'id'], id);
  if (label !== undefined) doc.setIn(['sticks', wrist, 'label'], label);
  if (ip !== undefined) doc.setIn(['sticks', wrist, 'ip'], ip);
  if (!doc.hasIn(['sticks', wrist, 'label'])) doc.setIn(['sticks', wrist, 'label'], wrist);
  return doc.toString();
}
