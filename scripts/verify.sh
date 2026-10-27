#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
CIRCUITS="$ROOT/circuits"
SNARKJS="$CIRCUITS/node_modules/.bin/snarkjs"

echo "==> Verifying proof..."
"$SNARKJS" groth16 verify \
    "$BUILD/verification_key.json" \
    "$BUILD/public.json" \
    "$BUILD/proof.json"
