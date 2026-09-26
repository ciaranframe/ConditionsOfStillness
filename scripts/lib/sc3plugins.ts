import { readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isAppleDouble } from './env.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Delete every AppleDouble `._*` file under root; a single one breaks SuperCollider's class compile. */
export function stripAppleDouble(root: string): string[] {
  const removed: string[] = [];
  for (const p of walk(root)) {
    const rel = relative(root, p);
    if (isAppleDouble(rel)) { rmSync(p); removed.push(rel); }
  }
  return removed;
}

export function pluginsPresent(extensionsDir: string): boolean {
  const dir = join(extensionsDir, 'SC3plugins');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return walk(dir).some((p) => p.endsWith('.sc') || p.endsWith('.scx'));
}
