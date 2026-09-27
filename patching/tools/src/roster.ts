// airkit/lists/list_conditions.sc: the Conditions of Stillness roster. AirKit reads
// <root>/lists/<AIRKIT_LIST> from personalityController.scd; the Conditions profile sets
// AIRKIT_LIST=list_conditions.sc. Shape: ["silence", ...names..., "silence"] — index 0 is what
// a new device gets, the LAST entry is unreachable (loadPersonality wraps with
// index.mod(size-1)) and is a sentinel; both bookends are preserved by every edit here.
//
// The airkit/ worktree is a separate git repo (AirConditions, mirrored) from this one — writing
// the roster file does not commit it; the skill's roster step does that (`cos:` commit) later.
//
// Parsing mirrors runner/src/scenes.ts's parseRosterFile (`/"([^"\n]+)"/g`) so both readers of
// this file agree on what a name looks like.
import { readFileSync } from 'node:fs';
import { writeAtomic } from './atomic.ts';
import { rosterPath } from './sc.ts';

/** Valid patch names for the roster CLI: COS_UpperCamel. Checked by the CLI, not the library
 * functions below (a caller building a roster programmatically may have its own reasons to pass
 * something else, e.g. "silence"). */
export const NAME_RE = /^COS_[A-Z][A-Za-z0-9]*$/;

/** The leading run of `//` comment lines, each with its trailing newline — reproduced verbatim
 * by renderRoster so a round-trip is byte-for-byte. */
export function extractCommentHeader(text: string): string {
  let out = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('//')) break;
    out += line + '\n';
  }
  return out;
}

/** Names in order, including both "silence" bookends. The comment header is stripped first —
 * this file's header prose itself quotes `"silence"` as an example of the shape, so matching
 * quoted strings against the whole text (as runner/src/scenes.ts's parseRosterFile does) would
 * pick that up too; scanning only the body after the header avoids it. */
export function parseRoster(text: string): string[] {
  const body = text.slice(extractCommentHeader(text).length);
  return [...body.matchAll(/"([^"\n]+)"/g)].map((m) => m[1]!);
}

/** Renders `names` back into the file's exact layout: the given comment header, then a tab-
 * indented `[...]` list with one quoted name per line and a trailing comma on every entry
 * (including the last), matching the hand-authored file this replaces. */
export function renderRoster(names: string[], commentHeader: string): string {
  const body = names.map((n) => `\t\t"${n}",\n`).join('');
  return `${commentHeader}(\n\t[\n${body}\t]\n)\n`;
}

function readRoster(): { header: string; names: string[] } {
  const text = readFileSync(rosterPath(), 'utf8');
  return { header: extractCommentHeader(text), names: parseRoster(text) };
}

/** Idempotent: inserts `name` just before the trailing sentinel unless it is already present
 * anywhere in the roster. Index 0 and the sentinel are never disturbed. A true no-op (nothing
 * read back out, no `writeAtomic`, file left byte-for-byte and mtime-for-mtime untouched) when
 * `name` is already present. Returns whether it actually wrote. */
export function rosterAdd(name: string): boolean {
  const { header, names } = readRoster();
  if (names.includes(name)) return false;
  names.splice(names.length - 1, 0, name);
  writeAtomic(rosterPath(), renderRoster(names, header));
  return true;
}

/** Idempotent: removes every occurrence of `name` except at index 0 or the trailing sentinel
 * position, which are never removed regardless of their value. A true no-op (no `writeAtomic`)
 * when there is nothing removable — `name` absent entirely, or present only at the bookends.
 * Returns whether it actually wrote. */
export function rosterRemove(name: string): boolean {
  const { header, names } = readRoster();
  const last = names.length - 1;
  const removable = names.some((n, i) => i !== 0 && i !== last && n === name);
  if (!removable) return false;
  const kept = names.filter((n, i) => i === 0 || i === last || n !== name);
  writeAtomic(rosterPath(), renderRoster(kept, header));
  return true;
}

/** The current roster, in order (for `patch-roster.ts list`). */
export function rosterList(): string[] {
  return parseRoster(readFileSync(rosterPath(), 'utf8'));
}
