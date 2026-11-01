#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Building the Rust engine..."
(cd "$ROOT" && cargo build --release)

echo "==> Running the Groth16 trusted setup..."
(cd "$ROOT" && ./target/release/zk-battleship setup)

echo "==> Building the browser cipher engine (wasm)..."
rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true
(cd "$ROOT/wasm-crypto" && cargo build --release --target wasm32-unknown-unknown)
cp "$ROOT/wasm-crypto/target/wasm32-unknown-unknown/release/zkb_wasm_crypto.wasm" "$ROOT/web/crypto_engine.wasm"

echo ""
echo "Setup complete."
echo "  Engine binary:  $ROOT/target/release/zk-battleship"
echo "  Keys:           $ROOT/build/rust/"
echo "  Cipher engine:  $ROOT/web/crypto_engine.wasm"
echo ""
echo "Next: python3 web/server.py"
