// sclang paths and the headless compile check. The compile-check idiom (a throwaway sclang that
// compiles a file and posts OK/PARSE FAILED, then 0.exit) is Glimmer's
// (airkit-glimmer/tools/patch-compile.sh), reused here with the env var renamed COS_CHECK_FILE.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// COS_SCLANG overrides (tests use it to exercise a missing sclang).
export const SCLANG = process.env.COS_SCLANG ?? '/Applications/SuperCollider.app/Contents/MacOS/sclang';

// Walk up from this file to find airkit.lock, which lives at the repo root. COS_REPO_ROOT
// overrides for tests or an unusual checkout (same idiom as scripts/setup.ts's findRepoRoot).
export function repoRoot(): string {
  if (process.env.COS_REPO_ROOT) return resolve(process.env.COS_REPO_ROOT);
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'airkit.lock'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('airkit.lock not found above patching/tools/src/; set COS_REPO_ROOT');
}

export function airkitRoot(): string {
  return join(repoRoot(), 'airkit');
}

// Canonical path for a personality by its bare name (e.g. "COS_Template" -> .../airkit/
// personalities/COS_Template.sc). Tools that already have a path (a .tmp before its rename,
// say) use that path directly instead of calling this.
export function personalityPath(name: string): string {
  return join(airkitRoot(), 'personalities', `${name}.sc`);
}

export function rosterPath(): string {
  return join(airkitRoot(), 'lists', 'list_conditions.sc');
}

const CHECK_SCD = `(
var fn = thisProcess.interpreter.compile(File.readAllString("COS_CHECK_FILE".getenv));
if (fn.isNil) { "COMPILECHECK: PARSE FAILED".postln } { "COMPILECHECK: OK".postln };
0.exit;
)
`;

// Parse-checks `file` in a throwaway headless sclang (~3 s): compiles it (never runs it) and
// reports OK or PARSE FAILED. A 30 s timeout is a last-resort kill switch — the check script
// always calls 0.exit itself, so a healthy run never approaches it — but a compile check must
// never leave an orphaned sclang process behind.
export function compileCheck(file: string, port = 57190): { ok: boolean; output: string } {
  const dir = join(tmpdir(), 'cos-compile-check');
  mkdirSync(dir, { recursive: true });
  const scd = join(dir, `check-${process.pid}-${Date.now()}.scd`);
  writeFileSync(scd, CHECK_SCD);
  let result;
  try {
    result = spawnSync(SCLANG, ['-u', String(port), scd], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, COS_CHECK_FILE: resolve(file) },
    });
  } finally {
    rmSync(scd, { force: true });
  }
  const output = ((result.stdout ?? '') + (result.stderr ?? '')).trim();
  const ok = /COMPILECHECK: OK/.test(output);
  return { ok, output };
}
