mod board;
mod circuit;
mod commitment;
mod tests;
mod zk;

use ark_bn254::{Bn254, Fr};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::{PreparedVerifyingKey, Proof, ProvingKey, VerifyingKey};
use ark_serialize::{CanonicalDeserialize, CanonicalSerialize};
use base64::Engine;
use num_bigint::BigUint;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

fn build_dir() -> PathBuf {
    PathBuf::from("build/rust")
}

fn seed_path() -> PathBuf {
    build_dir().join("seed.bin")
}

fn pk_path() -> PathBuf {
    build_dir().join("proving_key.bin")
}

fn vk_path() -> PathBuf {
    build_dir().join("verifying_key.bin")
}

fn read_stdin() -> String {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("failed to read stdin");
    buf
}

fn fr_to_decimal(f: &Fr) -> String {
    BigUint::from_bytes_le(&f.into_bigint().to_bytes_le()).to_string()
}

fn fr_from_decimal(s: &str) -> Fr {
    let n = BigUint::parse_bytes(s.as_bytes(), 10).expect("invalid decimal field element");
    Fr::from_le_bytes_mod_order(&n.to_bytes_le())
}

fn bits_from_strings(board: &[String]) -> Vec<u8> {
    board.iter().map(|s| if s == "1" { 1 } else { 0 }).collect()
}

fn base64_encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn base64_decode(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .expect("invalid base64")
}

#[derive(Deserialize)]
struct CommitInput {
    board: Vec<String>,
    salt: String,
}

#[derive(Deserialize)]
struct ProveInput {
    board: Vec<String>,
    salt: String,
    shot_row: String,
    shot_col: String,
}

#[derive(Serialize, Deserialize)]
struct ProofJson {
    protocol: String,
    curve: String,
    data: String,
}

#[derive(Serialize)]
struct ProveOutput {
    commitment: String,
    is_hit: String,
    proof: ProofJson,
    public: Vec<String>,
}

#[derive(Deserialize)]
struct VerifyInput {
    proof: ProofJson,
    public: Vec<String>,
}

fn load_seed() -> [u8; 32] {
    let bytes = fs::read(seed_path()).expect("missing seed, run `setup` first");
    bytes.try_into().expect("corrupt seed file")
}

fn load_pk() -> ProvingKey<Bn254> {
    let bytes = fs::read(pk_path()).expect("missing proving key, run `setup` first");
    ProvingKey::deserialize_compressed(&bytes[..]).expect("corrupt proving key")
}

fn load_pvk() -> PreparedVerifyingKey<Bn254> {
    let bytes = fs::read(vk_path()).expect("missing verifying key, run `setup` first");
    let vk = VerifyingKey::deserialize_compressed(&bytes[..]).expect("corrupt verifying key");
    zk::prepare_vk(&vk)
}

fn cmd_setup() {
    fs::create_dir_all(build_dir()).expect("failed to create build directory");
    let mut rng = OsRng;
    let seed = commitment::public_seed(&mut rng);
    let (pk, vk) = zk::setup(seed, &mut rng);

    fs::write(seed_path(), seed).expect("failed to write seed");

    let mut pk_bytes = Vec::new();
    pk.serialize_compressed(&mut pk_bytes).expect("failed to serialize proving key");
    fs::write(pk_path(), pk_bytes).expect("failed to write proving key");

    let mut vk_bytes = Vec::new();
    vk.serialize_compressed(&mut vk_bytes).expect("failed to serialize verifying key");
    fs::write(vk_path(), vk_bytes).expect("failed to write verifying key");

    println!("setup complete: {}", build_dir().display());
}

fn cmd_commit() {
    let input: CommitInput = serde_json::from_str(&read_stdin()).expect("invalid input json");
    let seed = load_seed();
    let bits = bits_from_strings(&input.board);
    let salt = fr_from_decimal(&input.salt);
    let commitment = commitment::commit(&bits, salt, seed);
    println!("{}", fr_to_decimal(&commitment));
}

fn cmd_prove() {
    let input: ProveInput = serde_json::from_str(&read_stdin()).expect("invalid input json");
    let seed = load_seed();
    let pk = load_pk();
    let bits = bits_from_strings(&input.board);
    let salt = fr_from_decimal(&input.salt);
    let row: u8 = input.shot_row.parse().expect("invalid shot_row");
    let col: u8 = input.shot_col.parse().expect("invalid shot_col");

    let commitment = commitment::commit(&bits, salt, seed);
    let hit = bits[row as usize * 10 + col as usize] == 1;

    let mut rng = OsRng;
    let proof = zk::prove(&pk, bits, salt, commitment, row, col, hit, seed, &mut rng);

    let mut proof_bytes = Vec::new();
    proof.serialize_compressed(&mut proof_bytes).expect("failed to serialize proof");

    let is_hit = if hit { "1" } else { "0" }.to_string();
    let output = ProveOutput {
        commitment: fr_to_decimal(&commitment),
        is_hit: is_hit.clone(),
        proof: ProofJson {
            protocol: "groth16".to_string(),
            curve: "bn254".to_string(),
            data: base64_encode(&proof_bytes),
        },
        public: vec![fr_to_decimal(&commitment), row.to_string(), col.to_string(), is_hit],
    };
    println!("{}", serde_json::to_string(&output).expect("failed to serialize output"));
}

fn cmd_verify() {
    let input: VerifyInput = serde_json::from_str(&read_stdin()).expect("invalid input json");
    let pvk = load_pvk();

    let result = (|| -> Option<bool> {
        if input.public.len() != 4 {
            return None;
        }
        let proof_bytes = base64_decode(&input.proof.data);
        let proof = Proof::<Bn254>::deserialize_compressed(&proof_bytes[..]).ok()?;
        let commitment = fr_from_decimal(&input.public[0]);
        let row: u8 = input.public[1].parse().ok()?;
        let col: u8 = input.public[2].parse().ok()?;
        let is_hit = input.public[3] == "1";
        Some(zk::verify(&pvk, commitment, row, col, is_hit, &proof))
    })()
    .unwrap_or(false);

    println!("{result}");
}

fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    match command.as_str() {
        "setup" => cmd_setup(),
        "commit" => cmd_commit(),
        "prove" => cmd_prove(),
        "verify" => cmd_verify(),
        _ => {
            eprintln!("usage: zk-battleship <setup|commit|prove|verify>");
            std::process::exit(1);
        }
    }
}
