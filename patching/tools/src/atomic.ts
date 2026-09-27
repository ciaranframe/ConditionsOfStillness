// Atomic file writes for every tool that edits a checked-in file (roster, manifests, notes,
// the corpus index, …). The engine hot-loads personalities on mtime, so a half-written file
// must never be observable: write to a temp path next to the target, then rename (POSIX rename
// is atomic within the same filesystem).
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
