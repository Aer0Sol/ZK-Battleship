#!/usr/bin/env node
const path = require("path");
const fs   = require("fs");
const os   = require("os");
const { execFileSync } = require("child_process");
const { buildPoseidon } = require(path.join(__dirname, "../circuits/node_modules/circomlibjs"));

const ROOT    = path.join(__dirname, "..");
const BUILD   = path.join(ROOT, "build");
const SNARKJS = path.join(ROOT, "circuits/node_modules/.bin/snarkjs");

async function main() {
    const inp    = JSON.parse(fs.readFileSync("/dev/stdin", "utf8"));
    const board  = inp.board.map(BigInt);
    const salt   = BigInt(inp.salt);
    const row    = parseInt(inp.shot_row);
    const col    = parseInt(inp.shot_col);
    const isHit  = board[row * 10 + col] !== 0n ? 1 : 0;

    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const rowHashes = Array.from({ length: 10 }, (_, r) =>
        F.toObject(poseidon(board.slice(r * 10, r * 10 + 10)))
    );
    const commitment = F.toObject(poseidon([...rowHashes, salt]));

    const tag  = `${process.pid}_${Date.now()}`;
    const tmp  = (name) => path.join(os.tmpdir(), `zk_${name}_${tag}.json`);
    const wtns = path.join(os.tmpdir(), `zk_witness_${tag}.wtns`);
    const inp_path   = tmp("input");
    const proof_path = tmp("proof");
    const pub_path   = tmp("public");

    fs.writeFileSync(inp_path, JSON.stringify({
        board: board.map(String), salt: salt.toString(),
        commitment: commitment.toString(),
        shot_row: String(row), shot_col: String(col), is_hit: String(isHit),
    }));

    process.stderr.write("[zk] witness…\n");
    execFileSync("node", [path.join(BUILD, "shot_js/generate_witness.js"),
                          path.join(BUILD, "shot_js/shot.wasm"), inp_path, wtns]);

    process.stderr.write("[zk] prove…\n");
    execFileSync(SNARKJS, ["groth16", "prove",
                           path.join(BUILD, "shot_final.zkey"), wtns, proof_path, pub_path]);

    const result = {
        commitment: commitment.toString(),
        is_hit: String(isHit),
        proof:  JSON.parse(fs.readFileSync(proof_path, "utf8")),
        public: JSON.parse(fs.readFileSync(pub_path,   "utf8")),
    };

    for (const f of [inp_path, wtns, proof_path, pub_path]) {
        try { fs.unlinkSync(f); } catch (_) {}
    }

    console.log(JSON.stringify(result));
}

main().catch(e => { process.stderr.write(e.message + "\n"); process.exit(1); });
