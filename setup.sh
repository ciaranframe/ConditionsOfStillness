#!/bin/bash
# Prepare this Mac for Conditions of Stillness. `./setup.sh --check` only reports.
# Everything else lives in scripts/setup.ts; this wrapper only guarantees Node is there.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 22.18 is required (https://nodejs.org). Install it, then rerun ./setup.sh" >&2
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' || { echo "Node.js >= 22.18 is required (found $(node --version)). Install it, then rerun ./setup.sh" >&2; exit 1; }
exec node scripts/setup.ts "$@"
