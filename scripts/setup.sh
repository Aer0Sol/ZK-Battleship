#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUITS="$ROOT/circuits"
BUILD="$ROOT/build"
SCRIPTS="$ROOT/scripts"

mkdir -p "$BUILD"

echo "==> Installing npm dependencies..."
(cd "$CIRCUITS" && npm install --silent)
SNARKJS="$CIRCUITS/node_modules/.bin/snarkjs"

echo "==> Compiling shot.circom..."
circom "$CIRCUITS/shot.circom" \
    --r1cs --wasm --sym \
    --include "$CIRCUITS" \
    -o "$BUILD"
echo "    Constraints: $(grep -c 'constraint' "$BUILD/shot.sym" 2>/dev/null || echo 'see shot.r1cs')"

PTAU="$BUILD/pot15_final.ptau"
if [ ! -f "$PTAU" ]; then
    echo "==> Running powers of tau ceremony..."
    "$SNARKJS" powersoftau new bn128 15 "$BUILD/pot15_0000.ptau" -v
    "$SNARKJS" powersoftau contribute "$BUILD/pot15_0000.ptau" "$BUILD/pot15_0001.ptau" \
        --name="ZK-Battleship setup" -e="zkbattleship entropy $(date)"
    "$SNARKJS" powersoftau prepare phase2 "$BUILD/pot15_0001.ptau" "$PTAU" -v
fi

echo "==> Running Groth16 phase-2 setup..."
"$SNARKJS" groth16 setup "$BUILD/shot.r1cs" "$PTAU" "$BUILD/shot_0000.zkey"
"$SNARKJS" zkey contribute "$BUILD/shot_0000.zkey" "$BUILD/shot_final.zkey" \
    --name="Prover key" -e="more entropy $(hostname)"
"$SNARKJS" zkey export verificationkey "$BUILD/shot_final.zkey" "$BUILD/verification_key.json"

echo ""
echo "Setup complete."
echo "  Proving key:       $BUILD/shot_final.zkey"
echo "  Verification key:  $BUILD/verification_key.json"
echo ""
echo "Next: run  scripts/demo.sh  for a full end-to-end example."
