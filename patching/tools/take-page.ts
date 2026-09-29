// CLI for the take page (src/take-page.ts): a standalone recording desk in the browser.
//
// Usage: node patching/tools/take-page.ts [--port 9000] [--web 3001] [--as CF] [--out DIR]
// Hears every stick streaming to udp --port (default 9000: where the Glimmer C-stick firmware
// sends; use 8000 with the runner stopped for an AirKit stick), serves the page on
// http://localhost:<web>/ and records takes to takes/<label>.take.jsonl (+ INDEX.md row),
// filed under --as unless a wrist is chosen on the page. Planned takes come from takes/PLAN.md.
// Ctrl-C stops any live take cleanly, then exits.
// Exit 0 on Ctrl-C; 1 could not start (port in use, bad --as); 2 usage.
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { startTakePage } from './src/take-page.ts';

const USAGE = 'usage: take-page.ts [--port 9000] [--web 3001] [--as CF] [--out DIR]';
function fail(msg: string): never { console.error(`take-page: ${msg}`); console.error(USAGE); process.exit(2); }

const argv = process.argv.slice(2);
let udpPort: number | undefined; let webPort: number | undefined; let as: string | undefined; let out: string | undefined;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  switch (a) {
    case '--port': udpPort = Number(argv[++i]); break;
    case '--web': webPort = Number(argv[++i]); break;
    case '--as': as = argv[++i]; break;
    case '--out': out = resolve(argv[++i] ?? ''); break;
    case '-h': case '--help': console.log(USAGE); process.exit(0);
    default: fail(`unknown option ${a}`);
  }
}
for (const [name, v] of [['--port', udpPort], ['--web', webPort]] as const) {
  if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 65535)) fail(`${name} must be a port number`);
}

let page;
try {
  page = await startTakePage({ udpPort, webPort, as, out });
} catch (e) {
  console.error(`take-page: could not start: ${(e as Error).message}`);
  process.exit(1);
}

const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n!.address);
console.error(`take-page: hearing sticks on udp ${page.udpPort} (this Mac: ${ips.join(', ') || 'no IPv4 address'})`);
console.error(`take-page: open http://localhost:${page.webPort}/  — takes filed as ${page.state().as} in ${page.state().out}`);
console.error(`take-page: planned takes come from ${page.state().planPath}`);

const shutdown = async () => {
  const r = await page.stop();
  if (r) console.error(`take-page: stopped ${r.written ? `${r.rows} rows -> ${r.path}` : 'the live take (no packets, nothing written)'}`);
  await page.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
