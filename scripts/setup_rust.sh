#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building the Rust engine..."
(cd "$ROOT" && cargo build --release)

echo "==> Running the Groth16 trusted setup..."
(cd "$ROOT" && ./target/release/zk-battleship setup)

echo ""
echo "Setup complete."
echo "  Engine binary:  $ROOT/target/release/zk-battleship"
echo "  Keys:           $ROOT/build/rust/"
echo ""
echo "Next: python3 web/server.py"
