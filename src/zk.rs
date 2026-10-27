use ark_bn254::{Bn254, Fr};
use ark_groth16::{Groth16, PreparedVerifyingKey, ProvingKey, VerifyingKey};
use ark_snark::SNARK;
use ark_std::rand::{CryptoRng, RngCore};

use crate::circuit::ShotCircuit;

pub type Proof = ark_groth16::Proof<Bn254>;

pub fn setup(
    seed: [u8; 32],
    rng: &mut (impl RngCore + CryptoRng),
) -> (ProvingKey<Bn254>, VerifyingKey<Bn254>) {
    Groth16::<Bn254>::circuit_specific_setup(ShotCircuit::blank(seed), rng)
        .expect("groth16 setup failed")
}

pub fn prepare_vk(vk: &VerifyingKey<Bn254>) -> PreparedVerifyingKey<Bn254> {
    Groth16::<Bn254>::process_vk(vk).expect("vk processing failed")
}

pub fn prove(
    pk: &ProvingKey<Bn254>,
    board: Vec<u8>,
    salt: Fr,
    commitment: Fr,
    shot_row: u8,
    shot_col: u8,
    is_hit: bool,
    seed: [u8; 32],
    rng: &mut (impl RngCore + CryptoRng),
) -> Proof {
    let circuit = ShotCircuit {
        board: Some(board),
        salt: Some(salt),
        commitment: Some(commitment),
        shot_row: Some(shot_row),
        shot_col: Some(shot_col),
        is_hit: Some(is_hit),
        seed,
    };
    Groth16::<Bn254>::prove(pk, circuit, rng).expect("groth16 prove failed")
}

pub fn verify(
    pvk: &PreparedVerifyingKey<Bn254>,
    commitment: Fr,
    shot_row: u8,
    shot_col: u8,
    is_hit: bool,
    proof: &Proof,
) -> bool {
    let inputs = [
        commitment,
        Fr::from(shot_row as u64),
        Fr::from(shot_col as u64),
        Fr::from(is_hit as u64),
    ];
    Groth16::<Bn254>::verify_with_processed_vk(pvk, &inputs, proof).unwrap_or(false)
}
