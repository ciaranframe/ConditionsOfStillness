// Pure decisions for setup.ts. No I/O here: everything is testable with plain values.

export type Lock = { branch: string; sha: string; upstream: string; mirror: string };

export function parseLock(text: string): Lock {
  const kv = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    kv.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const need = (k: keyof Lock): string => {
    const v = kv.get(k);
    if (v === undefined || v === '') throw new Error(`airkit.lock: missing key ${k}`);
    return v;
  };
  return { branch: need('branch'), sha: need('sha'), upstream: need('upstream'), mirror: need('mirror') };
}

export function versionAtLeast(found: string, min: string): boolean {
  const a = found.split('.').map((x) => parseInt(x, 10) || 0);
  const b = min.split('.').map((x) => parseInt(x, 10) || 0);
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export type AirkitState = {
  worktreeExists: boolean;
  worktreeBranch: string | null;
  homeCloneExists: boolean;
  homeCloneHasBranch: boolean;
};
export type AirkitAction = 'ok' | 'add-worktree' | 'fetch-mirror-then-add-worktree' | 'clone-mirror' | 'wrong-branch';

// The branch name is fixed by airkit.lock; callers pass the worktree's actual branch.
export function decideAirkitAction(s: AirkitState, branch = 'AirConditions'): AirkitAction {
  if (s.worktreeExists) return s.worktreeBranch === branch ? 'ok' : 'wrong-branch';
  if (!s.homeCloneExists) return 'clone-mirror';
  return s.homeCloneHasBranch ? 'add-worktree' : 'fetch-mirror-then-add-worktree';
}

export function lockStatus(lock: Lock, headSha: string | null): 'match' | 'drift' | 'unknown' {
  if (headSha === null) return 'unknown';
  return headSha === lock.sha ? 'match' : 'drift';
}

export function isAppleDouble(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? '';
  return base.startsWith('._');
}

export type Check = { name: string; ok: boolean; detail: string; fix?: string };

export function renderReport(checks: Check[]): string {
  const lines: string[] = [];
  let bad = 0;
  for (const c of checks) {
    lines.push(`${c.ok ? '[ok]' : '[!!]'} ${c.name}: ${c.detail}`);
    if (!c.ok) {
      bad++;
      if (c.fix) lines.push(`    fix: ${c.fix}`);
    }
  }
  lines.push(bad === 0 ? 'all good' : `${bad} item(s) need attention`);
  return lines.join('\n');
}
