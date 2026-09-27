// Shared show-test rig: a fake engine, a real AirkitLink, a temp state store and a booted Show.
// Lives outside the *.test.ts files so importing it does not re-register another file's tests.
import type { TestContext } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeAirkit } from './fake-airkit.ts';
import { AirkitLink } from '../src/airkit.ts';
import { Show } from '../src/show.ts';
import { parseScenes } from '../src/scenes.ts';
import { parseCast } from '../src/cast.ts';
import { StateStore } from '../src/state.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const ROSTER = ['silence', 'COS_Template', 'COS_A', 'COS_B', 'COS_X2H', 'silence'];
export const SCENES = `
piece: T
defaults: { fade: 0.05, level: 0 }
scenes:
  - { id: A, name: One,   sounds: { ZL: { patch: COS_A, params: { register: low } }, ZR: COS_A, CR: { patch: COS_Template, level: -6 } } }
  - { id: B, name: Two,   sounds: { ZR: { patch: COS_A, params: { register: high } }, CL: COS_B } }
  - { id: C, name: Three, sounds: { C: COS_X2H, ZL: silence } }
  - { id: D, name: Four,  fade: 0.4, sounds: { ZR: COS_B } }
`;
const cast = parseCast('sticks: { ZL: { id: 1, label: A3 }, ZR: { id: 2, label: A4 }, CL: { id: 3, label: B1 }, CR: { id: 4, label: B2 } }\n').cast;

export async function rig(t: TestContext, opts: { readyDelayMs?: number; readyTimeoutMs?: number; scenesText?: string; state?: object | null } = {}) {
  const fake = await fakeAirkit({ roster: ROSTER, readyDelayMs: opts.readyDelayMs ?? 10 });
  const airkit = new AirkitLink({ host: '127.0.0.1', port: fake.port, sourcePort: 0, pollMs: 50, log: () => {} });
  const store = new StateStore(join(mkdtempSync(join(tmpdir(), 'cos-show-')), 'current.json'));
  if (opts.state) store.save(opts.state as never);
  const lines: string[] = [];
  let closed = false;
  const close = () => { if (closed) return; closed = true; show.dispose(); airkit.close(); fake.close(); };
  t.after(close);   // a failed assertion must not leave sockets open and hang the run
  const show = new Show({ scenes: parseScenes(opts.scenesText ?? SCENES, ROSTER).file!.scenes, airkit, cast: () => cast, store, log: (m, l) => lines.push(`${l ?? 'info'} ${m}`), readyTimeoutMs: opts.readyTimeoutMs ?? 1000, unloadGraceMs: 10 });
  await airkit.start();
  await show.boot();
  for (let i = 0; i < 50 && !airkit.online; i++) await sleep(20);
  await sleep(150);   // let boot's pushAll settle
  const port = (slot: number) => airkit.portOf(slot);
  const sends = (addr: string, from = 0) => fake.log.slice(from).filter((m) => m.address === addr).map((m) => m.args);
  const loads = (from = 0) => sends('/airkit/loadPersonality', from).map(([p, i]) => [Number(p) - port(1) + 1, ROSTER[Number(i)]]);   // [slot, patch]
  return { fake, airkit, show, store, lines, port, sends, loads, mark: () => fake.log.length, close };
}
