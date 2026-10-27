#!/usr/bin/env node
const path = require("path");
const fs   = require("fs");
const os   = require("os");
const { execFileSync } = require("child_process");

const BUILD   = path.join(__dirname, "../build");
const SNARKJS = path.join(__dirname, "../circuits/node_modules/.bin/snarkjs");

const inp = JSON.parse(fs.readFileSync("/dev/stdin", "utf8"));
const tag = `${process.pid}_${Date.now()}`;
const proofPath = path.join(os.tmpdir(), `zk_proof_${tag}.json`);
const pubPath   = path.join(os.tmpdir(), `zk_pub_${tag}.json`);

fs.writeFileSync(proofPath, JSON.stringify(inp.proof));
fs.writeFileSync(pubPath,   JSON.stringify(inp.public));

try {
    execFileSync(SNARKJS, ["groth16", "verify",
                           path.join(BUILD, "verification_key.json"), pubPath, proofPath]);
    console.log("true");
    process.exit(0);
} catch (_) {
    console.log("false");
    process.exit(1);
} finally {
    try { fs.unlinkSync(proofPath); } catch (_) {}
    try { fs.unlinkSync(pubPath);   } catch (_) {}
}
