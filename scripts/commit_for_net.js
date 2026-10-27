#!/usr/bin/env node
const path = require("path");
const fs   = require("fs");
const { buildPoseidon } = require(path.join(__dirname, "../circuits/node_modules/circomlibjs"));

async function main() {
    const inp   = JSON.parse(fs.readFileSync("/dev/stdin", "utf8"));
    const board = inp.board.map(BigInt);
    const salt  = BigInt(inp.salt);

    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const rowHashes = Array.from({ length: 10 }, (_, r) =>
        F.toObject(poseidon(board.slice(r * 10, r * 10 + 10)))
    );
    console.log(F.toObject(poseidon([...rowHashes, salt])).toString());
}

main().catch(e => { process.stderr.write(e.message + "\n"); process.exit(1); });
