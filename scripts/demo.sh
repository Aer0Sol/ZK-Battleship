#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
CIRCUITS="$ROOT/circuits"
SNARKJS="$CIRCUITS/node_modules/.bin/snarkjs"

if [ ! -f "$BUILD/verification_key.json" ]; then
    bash "$ROOT/scripts/setup.sh"
fi

echo ""
echo "══════════════════════════════════════════"
echo "  ZK-Battleship  —  circom/snarkjs demo  "
echo "══════════════════════════════════════════"
echo ""

bash "$ROOT/scripts/prove.sh" 0 2

echo ""
echo "── Verifying honest proof ──────────────────"
bash "$ROOT/scripts/verify.sh"

echo ""
echo "── Tampering: claiming (0,2) is a MISS... ──"
python3 -c "
import json, sys
pub = json.load(open('$BUILD/public.json'))
pub[3] = '0' if pub[3] == '1' else '1'
json.dump(pub, open('$BUILD/public_tampered.json','w'))
print('Tampered public inputs:', pub)
"

if "$SNARKJS" groth16 verify \
    "$BUILD/verification_key.json" \
    "$BUILD/public_tampered.json" \
    "$BUILD/proof.json" 2>&1 | grep -q "OK"; then
    echo "FAIL: tampered proof accepted (should not happen)"
    exit 1
else
    echo "PASS: tampered proof correctly rejected by verifier."
fi

echo ""
echo "Demo complete."
