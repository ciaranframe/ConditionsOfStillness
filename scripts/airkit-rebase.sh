#!/bin/bash
# Rebase our AirConditions branch onto Steph's latest AirConcert, by explicit choice only.
# Never touches origin (sohla/AirKit): the only push is --force-with-lease to the private mirror.
#   exit 0 ok · 2 conflict (aborted, tree untouched) · 3 dirty worktree · 1 other error
# COS_AIRKIT_WORKTREE overrides the worktree path (tests).
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WT="${COS_AIRKIT_WORKTREE:-$HERE/airkit}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

if [ -n "$(git -C "$WT" status --porcelain | grep -v '\.DS_Store')" ]; then
  echo "airkit-rebase: worktree is dirty ($WT). Commit or stash first." >&2; exit 3
fi
BR="$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
[ "$BR" = "AirConditions" ] || { echo "airkit-rebase: expected branch AirConditions, on $BR" >&2; exit 1; }

git -C "$WT" fetch -q origin AirConcert || { echo "airkit-rebase: fetch failed" >&2; exit 1; }
echo "== incoming from origin/AirConcert =="
git -C "$WT" log --oneline --no-decorate "HEAD..origin/AirConcert" | sed 's/^/  /'
NEW=$(git -C "$WT" rev-list --count "HEAD..origin/AirConcert")
[ "$NEW" = "0" ] && { echo "already up to date"; exit 0; }

if [ "$DRY" = "1" ]; then
  echo "would run: git rebase origin/AirConcert"
  echo "would run: git push --force-with-lease mirror AirConditions"
  exit 0
fi

BEFORE="$(git -C "$WT" rev-parse HEAD)"
if ! git -C "$WT" rebase origin/AirConcert >/dev/null 2>&1; then
  echo "airkit-rebase: CONFLICT. Files:" >&2
  git -C "$WT" diff --name-only --diff-filter=U | sed 's/^/  /' >&2
  git -C "$WT" rebase --abort
  AFTER="$(git -C "$WT" rev-parse HEAD)"
  if [ "$AFTER" = "$BEFORE" ] && [ -z "$(git -C "$WT" status --porcelain | grep -v '\.DS_Store')" ]; then
    echo "Aborted; tree restored. Resolve by hand only by re-applying OUR commits on top of Steph's lines — never rewrite hers." >&2
    exit 2
  else
    echo "airkit-rebase: abort did NOT restore the tree — HEAD was $BEFORE; inspect $WT by hand" >&2
    exit 1
  fi
fi
git -C "$WT" push --force-with-lease mirror AirConditions || { echo "airkit-rebase: mirror push failed (rebase kept)" >&2; exit 1; }
SHA="$(git -C "$WT" rev-parse HEAD)"
echo "rebased and mirrored. Update airkit.lock:"
echo "sha=$SHA"
