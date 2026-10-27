#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
CIRCUITS="$ROOT/circuits"
SNARKJS="$CIRCUITS/node_modules/.bin/snarkjs"

SHOT_ROW="${1:-0}"
SHOT_COL="${2:-2}"

echo "==> Generating witness input for shot (${SHOT_ROW}, ${SHOT_COL})..."
node "$ROOT/scripts/gen_input.js" "$SHOT_ROW" "$SHOT_COL"

echo "==> Computing witness..."
node "$BUILD/shot_js/generate_witness.js" \
    "$BUILD/shot_js/shot.wasm" \
    "$BUILD/input.json" \
    "$BUILD/witness.wtns"

echo "==> Generating Groth16 proof..."
"$SNARKJS" groth16 prove \
    "$BUILD/shot_final.zkey" \
    "$BUILD/witness.wtns" \
    "$BUILD/proof.json" \
    "$BUILD/public.json"

echo ""
echo "Proof:          $BUILD/proof.json"
echo "Public inputs:  $(cat "$BUILD/public.json")"
