#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8080}"

cd "$ROOT"
PORT="$PORT" python3 web/server.py &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

for _ in {1..20}; do
    if curl -fsS "http://localhost:$PORT/health" | grep -q '"zk_available": true'; then
        ssh -R "80:localhost:$PORT" serveo.net
        exit 0
    fi
    sleep 1
done

echo "ZK gateway did not become ready. Run scripts/setup.sh first." >&2
exit 1
