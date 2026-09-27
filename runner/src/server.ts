// HTTP (the two pages, static files, /api/view) + WebSocket (view and log out, commands in) on one port.
// Shape, MIME table and static serving follow the Glimmer show engine's src/server/http.ts
// (code/show-engine/src/server/http.ts, Ciaran Frame 2026); the traversal guard is tightened here.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { WRISTS, type Wrist } from './scenes.ts';
import type { View } from './view.ts';
import type { Log, LogLine } from './log.ts';

export type Command =
  | { type: 'cue'; action: 'next' | 'back' } | { type: 'jump'; index: number } | { type: 'trim'; wrist: Wrist; db: number } | { type: 'master'; db: number }
  | { type: 'panic' } | { type: 'resume' } | { type: 'audition'; wrist: Wrist; patch: string | null } | { type: 'reload'; wrist: Wrist }
  | { type: 'assignStick'; wrist: Wrist; id: string | null; label?: string };
export interface ServerOptions { port: number; publicDir: string; view: () => View; log: Log; onCommand: (c: Command, source: 'page' | 'admin') => Promise<void> | void; broadcastMs?: number }

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
};
const PAGES: Record<string, string> = { '/perform': 'perform.html', '/admin': 'admin.html' };
const RECENT_LOG_LINES = 200;

/** The file a URL path names inside publicDir, or null when it is malformed or would escape it. */
export function staticPath(publicDir: string, urlPath: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const root = resolve(publicDir);
  const full = join(root, normalize(`/${decoded}`));
  return full.startsWith(root + sep) ? full : null;
}

function sendFile(res: ServerResponse, full: string | null): void {
  if (!full || !existsSync(full) || !statSync(full).isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(full).pipe(res);
}

const isWrist = (x: unknown): x is Wrist => typeof x === 'string' && (WRISTS as readonly string[]).includes(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A well-formed Command (only its own fields kept), or an error string. */
export function parseCommand(x: unknown): Command | string {
  if (!isRecord(x)) return 'command must be an object';
  const bad = (what: string) => `${String(x.type)}: ${what}`;
  switch (x.type) {
    case 'cue': return x.action === 'next' || x.action === 'back' ? { type: 'cue', action: x.action } : bad('action must be next or back');
    case 'jump': return Number.isInteger(x.index) ? { type: 'jump', index: x.index as number } : bad('index must be an integer');
    case 'trim': return isWrist(x.wrist) && isNum(x.db) ? { type: 'trim', wrist: x.wrist, db: x.db } : bad('needs wrist and db');
    case 'master': return isNum(x.db) ? { type: 'master', db: x.db } : bad('needs db');
    case 'panic': return { type: 'panic' };
    case 'resume': return { type: 'resume' };
    case 'audition': return isWrist(x.wrist) && (x.patch === null || typeof x.patch === 'string') ? { type: 'audition', wrist: x.wrist, patch: x.patch } : bad('needs wrist and patch (or null)');
    case 'reload': return isWrist(x.wrist) ? { type: 'reload', wrist: x.wrist } : bad('needs wrist');
    case 'assignStick': {
      if (!isWrist(x.wrist) || !(x.id === null || typeof x.id === 'string')) return bad('needs wrist and id (string or null)');
      if (x.label !== undefined && typeof x.label !== 'string') return bad('label must be a string');
      return x.label === undefined ? { type: 'assignStick', wrist: x.wrist, id: x.id } : { type: 'assignStick', wrist: x.wrist, id: x.id, label: x.label };
    }
    default: return `unknown command type ${JSON.stringify(x.type)}`;
  }
}

export function startServer(opts: ServerOptions): Promise<{ port: number; broadcast(): void; close(): void }> {
  const { log } = opts;
  const viewJson = (): string | null => {
    try { return JSON.stringify({ type: 'view', view: opts.view() }); }
    catch (e) { log.line(`[web] view failed: ${e instanceof Error ? e.message : String(e)}`, 'error'); return null; }
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/') { res.writeHead(302, { location: '/perform' }); res.end(); return; }
    if (path === '/api/view') {
      let body: string;
      try { body = JSON.stringify(opts.view()); } catch (e) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end(String(e)); return; }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' }); res.end(body); return;
    }
    const page = PAGES[path];
    sendFile(res, page ? join(resolve(opts.publicDir), page) : staticPath(opts.publicDir, path));
  });
  const wss = new WebSocketServer({ server });
  wss.on('error', (e) => log.line(`[web] websocket server error: ${e.message}`, 'error'));

  const sendAll = (s: string) => { for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s); };
  const broadcast = () => { if (wss.clients.size === 0) return; const s = viewJson(); if (s) sendAll(s); };
  const onLine = (l: LogLine) => { if (wss.clients.size > 0) sendAll(JSON.stringify({ type: 'log', lines: [l] })); };
  log.on('line', onLine);
  const timer = setInterval(broadcast, opts.broadcastMs ?? 100);
  timer.unref();

  // Logged at the handshake, before the client joins wss.clients: the line lands in its log tail rather than
  // arriving as a third frame, so a client's first two frames are always its view and its log tail.
  wss.on('headers', (_h, req) => log.line(`[web] client connected from ${req.socket.remoteAddress ?? '?'}`));
  wss.on('connection', (ws, req) => {
    const who = req.socket.remoteAddress ?? '?';
    const send = (msg: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
    const v = viewJson(); if (v) send(v);
    send({ type: 'log', lines: log.recent(RECENT_LOG_LINES) });
    // One command at a time per client, so acks come back in the order the commands were sent.
    let queue: Promise<void> = Promise.resolve();
    ws.on('message', (raw) => {
      queue = queue.then(async () => {
        let parsed: unknown;
        try { parsed = JSON.parse(String(raw)); } catch { send({ type: 'ack', ok: false, error: 'bad json' }); return; }
        const cmd = parseCommand(parsed);
        if (typeof cmd === 'string') { log.line(`[web] ${who}: refused — ${cmd}`, 'warn'); send({ type: 'ack', ok: false, error: cmd }); return; }
        log.line(`[web] ${who}: ${JSON.stringify(cmd)}`);
        try { await opts.onCommand(cmd, 'page'); send({ type: 'ack', ok: true }); }
        catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          log.line(`[web] ${cmd.type} failed: ${error}`, 'warn');
          send({ type: 'ack', ok: false, error });
        }
      });
    });
    ws.on('error', (e) => log.line(`[web] client ${who} error: ${e.message}`, 'warn'));
    ws.on('close', () => log.line(`[web] client ${who} disconnected`));
  });

  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    clearInterval(timer);
    log.off('line', onLine);
    for (const c of wss.clients) c.terminate();
    wss.close();
    server.close();
    server.closeAllConnections();
  };

  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '0.0.0.0', () => {
      server.off('error', reject);
      const port = (server.address() as AddressInfo).port;
      log.line(`[web] pages on http://0.0.0.0:${port} (/perform, /admin)`);
      resolvePort({ port, broadcast, close });
    });
  });
}
