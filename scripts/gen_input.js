#!/usr/bin/env node
const path = require("path");
const fs   = require("fs");
const { buildPoseidon } = require(path.join(__dirname, "../circuits/node_modules/circomlibjs"));

async function main() {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    const board = new Array(100).fill(0n);
    for (const [r, len] of [[0,5],[1,4],[2,3],[3,3],[4,2]]) {
        for (let c = 0; c < len; c++) board[r * 10 + c] = 1n;
    }

    const salt = BigInt("0x" + require("crypto").randomBytes(31).toString("hex"));

    const rowHashes = Array.from({ length: 10 }, (_, r) =>
        F.toObject(poseidon(board.slice(r * 10, r * 10 + 10)))
    );
    const commitment = F.toObject(poseidon([...rowHashes, salt]));

    const shotRow = parseInt(process.argv[2] ?? "0");
    const shotCol = parseInt(process.argv[3] ?? "2");
    if (shotRow < 0 || shotRow > 9 || shotCol < 0 || shotCol > 9) {
        console.error("row and col must be 0-9"); process.exit(1);
    }
    const isHit = board[shotRow * 10 + shotCol] !== 0n ? 1 : 0;

    const buildDir = path.join(__dirname, "../build");
    fs.mkdirSync(buildDir, { recursive: true });
    const outPath = path.join(buildDir, "input.json");
    fs.writeFileSync(outPath, JSON.stringify({
        board: board.map(String), salt: salt.toString(),
        commitment: commitment.toString(),
        shot_row: String(shotRow), shot_col: String(shotCol), is_hit: String(isHit),
    }, null, 2));

    console.log(`(${shotRow},${shotCol}) → ${isHit ? "HIT" : "miss"} | commitment: ${commitment.toString().slice(0,20)}…`);
    console.log(`written: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
