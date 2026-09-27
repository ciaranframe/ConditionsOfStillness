// Look at the pages without SuperCollider or sticks: a fake engine on 57140, four fake sticks
// (ids 1–4, stick 3 moving) streaming to udp 8000, and the real runner on the real scenes files.
// `npm --prefix runner run dev:fake`; Ctrl-C closes everything. Assigning sticks from Admin
// writes scenes/cast.yaml — revert it afterwards (`git checkout scenes/cast.yaml`).
import { readFileSync } from 'node:fs';
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

const fake = await fakeAirkit({ roster, port: FAKE_ENGINE_PORT });
const sticks = startFakeSticks({ target: { host: '127.0.0.1', port: 8000 }, ids: ['1', '2', '3', '4'], hz: 50, moving: new Set(['3']) });
const runner = await main({ airkitPort: FAKE_ENGINE_PORT, statePath: join(tmpdir(), 'cos-dev-state.json'), webPort: 3000, stickPort: 8000 });

const stop = () => { sticks.close(); void runner.close().finally(() => { fake.close(); process.exit(0); }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
