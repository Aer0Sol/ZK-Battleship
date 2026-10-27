use ark_bn254::Fr;
use ark_ff::{UniformRand, Zero};
use rand::{RngCore, SeedableRng};

pub fn public_seed(rng: &mut impl RngCore) -> [u8; 32] {
    let mut seed = [0; 32];
    rng.fill_bytes(&mut seed);
    seed
}

pub fn randomness(seed: [u8; 32]) -> Vec<Fr> {
    let mut rng = rand::rngs::StdRng::from_seed(seed);
    (0..101).map(|_| Fr::rand(&mut rng)).collect()
}

pub fn commit(board: &[u8], salt: Fr, seed: [u8; 32]) -> Fr {
    assert_eq!(board.len(), 100);
    let r = randomness(seed);
    assert_eq!(r.len(), 101);
    let mut c = Fr::zero();
    for (i, &b) in board.iter().enumerate() {
        c += Fr::from(b as u64) * r[i];
    }
    c += salt * r[100];
    c
}
