import { readdirSync, rmSync, statSync, existsSync, mkdtempSync, mkdirSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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

function sh(cmd: string, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout ?? '') + (r.stderr ?? '')).trim() };
}

export type InstallSc3PluginsOptions = {
  extensionsDir: string;
  /** Writes the sc3-plugins archive to destZip (e.g. by downloading it, or by copying a fixture in tests). */
  fetchArchive: (destZip: string) => void;
  log?: (s: string) => void;
};

export type InstallSc3PluginsResult = {
  installed: string;
  removedAppleDouble: number;
  movedAside: string | null;
};

/**
 * Install sc3-plugins atomically. The clean SC3plugins folder is built entirely in a temp
 * directory (unzip, then stripAppleDouble on the extracted copy) before anything under
 * `extensionsDir` is touched. Any pre-existing `<extensionsDir>/SC3plugins` is renamed aside
 * (never deleted) so a crash mid-install never destroys a working install, and the clean
 * folder is renamed into place as the last step. The temp directory is always removed, even
 * on failure.
 */
export function installSc3Plugins(opts: InstallSc3PluginsOptions): InstallSc3PluginsResult {
  const log = opts.log ?? (() => {});
  const tmp = mkdtempSync(join(tmpdir(), 'sc3-'));
  try {
    const zip = join(tmp, 'sc3.zip');
    opts.fetchArchive(zip);

    const un = sh('unzip', ['-q', zip, '-d', tmp]);
    if (!un.ok) throw new Error(`unzip failed: ${un.out}`);

    // The zip unpacks to a single folder containing SC3plugins/; find it.
    const found = sh('find', [tmp, '-maxdepth', '3', '-type', 'd', '-name', 'SC3plugins']).out.split('\n')[0];
    if (!found) throw new Error('SC3plugins folder not found in the archive');

    // Clean the folder in place, in the temp dir, before it ever touches extensionsDir.
    const removed = stripAppleDouble(found);

    mkdirSync(opts.extensionsDir, { recursive: true });
    const dest = join(opts.extensionsDir, 'SC3plugins');
    let movedAside: string | null = null;
    if (existsSync(dest)) {
      movedAside = `${dest}.replaced-${new Date().toISOString().replace(/:/g, '-')}`;
      renameSync(dest, movedAside);
    }
    try {
      renameSync(found, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        const mv = sh('mv', [found, dest]);
        if (!mv.ok) throw new Error(`move failed: ${mv.out}`);
      } else {
        throw e;
      }
    }

    log(`  installed SC3plugins; removed ${removed.length} AppleDouble file(s). Recompile the class library (Cmd-Shift-L) in any open SuperCollider.`);
    return { installed: dest, removedAppleDouble: removed.length, movedAside };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
