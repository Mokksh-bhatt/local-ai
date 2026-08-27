#!/usr/bin/env bash
# One-shot prompt against the local hub. Start the hub first: npm run dev
set -euo pipefail
HUB="${HUB:-http://127.0.0.1:5173}"
ADAPTER="${ADAPTER:-claude}"
WORKSPACE="${WORKSPACE:-$(pwd)}"
TEXT="${1:-${TEXT:-Reply with pong only. No extra words.}}"

# curl cannot do WebSocket easily; POST /api/prompt is the HTTP path.
curl -sS "$HUB/api/prompt" \
  -H "Content-Type: application/json" \
  -d "{\"adapterId\":\"$ADAPTER\",\"text\":\"$TEXT\",\"mode\":\"ask\",\"permission\":\"auto\",\"workspace\":\"$WORKSPACE\"}"
echo
