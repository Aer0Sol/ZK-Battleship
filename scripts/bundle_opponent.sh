#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
OUT="$ROOT/zk-battleship-opponent.zip"

for f in \
    "$BUILD/shot_final.zkey" \
    "$BUILD/verification_key.json" \
    "$BUILD/shot_js/shot.wasm" \
    "$BUILD/shot_js/generate_witness.js"
do
    if [ ! -f "$f" ]; then
        echo "Missing: $f"
        echo "Run  scripts/setup.sh  first."
        exit 1
    fi
done

echo "==> Bundling opponent package…"
rm -f "$OUT"

zip -j "$OUT" \
    "$ROOT/net/multiplayer.py" \
    "$ROOT/scripts/prove_for_net.js" \
    "$ROOT/scripts/verify_for_net.js" \
    "$BUILD/verification_key.json" \
    "$BUILD/shot_final.zkey"

zip "$OUT" \
    -j --junk-paths \
    "$BUILD/shot_js/shot.wasm" \
    "$BUILD/shot_js/generate_witness.js"

CIRCOMLIB_JS="$ROOT/circuits/node_modules/circomlibjs"
SNARKJS_BIN="$ROOT/circuits/node_modules/.bin/snarkjs"
SNARKJS_MOD="$ROOT/circuits/node_modules/snarkjs"

if [ -d "$CIRCOMLIB_JS" ] && [ -d "$SNARKJS_MOD" ]; then
    (cd "$ROOT/circuits" && zip -r "$OUT" \
        node_modules/circomlibjs \
        node_modules/snarkjs \
        node_modules/.bin/snarkjs \
        --exclude "*.git*" -q)
    echo "    node_modules included."
else
    echo "    [!] node_modules not found — opponent will need to run:"
    echo "        cd circuits && npm install"
    zip -j "$OUT" "$ROOT/circuits/package.json"
fi

cat > /tmp/zkb_setup.sh << 'SETUPEOF'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HERE/build/shot_js" "$HERE/scripts" "$HERE/circuits"

for f in shot.wasm generate_witness.js; do
    [ -f "$HERE/$f" ] && mv "$HERE/$f" "$HERE/build/shot_js/$f"
done
for f in prove_for_net.js verify_for_net.js; do
    [ -f "$HERE/$f" ] && mv "$HERE/$f" "$HERE/scripts/$f"
done
for f in verification_key.json shot_final.zkey; do
    [ -f "$HERE/$f" ] && mv "$HERE/$f" "$HERE/build/$f"
done
if [ -d "$HERE/node_modules" ]; then
    mkdir -p "$HERE/circuits"
    mv "$HERE/node_modules" "$HERE/circuits/node_modules"
fi

echo "Setup complete. Run:"
echo "  python multiplayer.py --join <host:port>"
SETUPEOF

zip -j "$OUT" /tmp/zkb_setup.sh
rm /tmp/zkb_setup.sh

SIZE=$(du -sh "$OUT" | cut -f1)
echo ""
echo "Bundle written: $OUT  ($SIZE)"
echo ""
echo "Send this file to your opponent. They:"
echo "  1. unzip zk-battleship-opponent.zip -d zkb"
echo "  2. cd zkb && bash zkb_setup.sh"
echo "  3. python multiplayer.py --join <your-playit-address:port>"
