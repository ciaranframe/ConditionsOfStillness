// Git-object-only access for corpus mining (plan ruling 2): nothing is ever checked out.
// `ls-tree -z` output is split on NUL, never on whitespace, so paths with spaces survive.
import { execFileSync } from 'node:child_process';

export type TreeFile = { path: string; blob: string; size: number };

const MAX = 256 * 1024 * 1024;

export function listTree(repo: string, ref: string, prefixes: string[]): TreeFile[] {
  const out = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '-l', '-z', ref, '--', ...prefixes], {
    encoding: 'utf8',
    maxBuffer: MAX,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const files: TreeFile[] = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    // "<mode> SP <type> SP <blob> SP+ <size> TAB <path>" — size is right-aligned with padding.
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, blob, size] = rec.slice(0, tab).trim().split(/ +/);
    const path = rec.slice(tab + 1);
    if (type !== 'blob' || mode === '120000') continue;
    if (!path.endsWith('.sc')) continue;
    if (path.includes('sc_osx_standalone')) continue;
    files.push({ path, blob, size: Number(size) });
  }
  return files;
}

const decoder = new TextDecoder('utf-8', { fatal: false });

export function readBlob(repo: string, blob: string): string {
  const buf = execFileSync('git', ['-C', repo, 'cat-file', '-p', blob], {
    maxBuffer: MAX,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return decoder.decode(buf); // invalid UTF-8 becomes U+FFFD
}

// The commit a ref points at, recorded in the index so the committed outputs say what was mined.
export function resolveCommit(repo: string, ref: string): string {
  return execFileSync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
