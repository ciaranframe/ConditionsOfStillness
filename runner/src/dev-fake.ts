// Look at the pages without SuperCollider or sticks: a fake engine on 57140, four fake sticks
// (ids 1–4, stick 3 moving) streaming to udp 8000, and the real runner on the real scenes file
// (edits show live) with a temp copy of scenes/cast.yaml, so assigning sticks from Admin leaves
// the repo untouched. `npm --prefix runner run dev:fake`; Ctrl-C closes everything.
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeAirkit } from '../test/fake-airkit.ts';
import { startFakeSticks } from '../test/fake-sticks.ts';
import { parseRosterFile } from './scenes.ts';
import { main, findRepoRoot } from './main.ts';

const FAKE_ENGINE_PORT = 57140;
const root = process.env.COS_REPO_ROOT ?? findRepoRoot();
const shipped = parseRosterFile(readFileSync(join(root, 'airkit', 'lists', 'list_conditions.sc'), 'utf8'));
// Demo patches go before the trailing "silence" sentinel so the Admin audition list has entries.
const roster = [...shipped.slice(0, -1), 'COS_Demo', 'COS_Demo2H', ...shipped.slice(-1)];

const castPath = join(mkdtempSync(join(tmpdir(), 'cos-dev-')), 'cast.yaml');
copyFileSync(join(root, 'scenes', 'cast.yaml'), castPath);
console.log(`[dev-fake] fake engine on 127.0.0.1:${FAKE_ENGINE_PORT}; fake sticks 1–4 → udp 8000; cast copy ${castPath}`);

const fake = await fakeAirkit({ roster, port: FAKE_ENGINE_PORT });
const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: 8000 }, ids: ['1', '2', '3', '4'], hz: 50, moving: new Set(['3']) });
const runner = await main({ castPath, airkitPort: FAKE_ENGINE_PORT, statePath: join(tmpdir(), 'cos-dev-state.json'), webPort: 3000, stickPort: 8000 });

const stop = () => { sticks.close(); void runner.close().finally(() => { fake.close(); process.exit(0); }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
