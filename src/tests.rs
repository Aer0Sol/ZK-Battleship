#[cfg(test)]
mod tests {
    use ark_bn254::Fr;
    use ark_ff::UniformRand;
    use rand::rngs::OsRng;
    use crate::{commitment, zk};

    fn test_board() -> Vec<u8> {
        let mut b = vec![0u8; 100];
        for i in 0..5 { b[i] = 1; }
        b
    }

    fn test_seed() -> [u8; 32] {
        [0; 32]
    }

    #[test]
    fn commitment_is_deterministic() {
        let mut rng = OsRng;
        let board = test_board();
        let salt = Fr::rand(&mut rng);
        let seed = test_seed();
        assert_eq!(commitment::commit(&board, salt, seed), commitment::commit(&board, salt, seed));
    }

    #[test]
    fn hit_proof_verifies() {
        let mut rng = OsRng;
        let board = test_board();
        let salt = Fr::rand(&mut rng);
        let seed = test_seed();
        let c = commitment::commit(&board, salt, seed);
        let (pk, vk) = zk::setup(seed, &mut rng);
        let pvk = zk::prepare_vk(&vk);

        let proof = zk::prove(&pk, board.clone(), salt, c, 0, 2, true, seed, &mut rng);
        assert!(zk::verify(&pvk, c, 0, 2, true, &proof));
        assert!(!zk::verify(&pvk, c, 0, 2, false, &proof));
    }

    #[test]
    fn miss_proof_verifies() {
        let mut rng = OsRng;
        let board = test_board();
        let salt = Fr::rand(&mut rng);
        let seed = test_seed();
        let c = commitment::commit(&board, salt, seed);
        let (pk, vk) = zk::setup(seed, &mut rng);
        let pvk = zk::prepare_vk(&vk);

        let proof = zk::prove(&pk, board.clone(), salt, c, 9, 9, false, seed, &mut rng);
        assert!(zk::verify(&pvk, c, 9, 9, false, &proof));
        assert!(!zk::verify(&pvk, c, 9, 9, true, &proof));
    }

    #[test]
    fn wrong_commitment_rejected() {
        let mut rng = OsRng;
        let board = test_board();
        let salt = Fr::rand(&mut rng);
        let seed = test_seed();
        let c = commitment::commit(&board, salt, seed);
        let (pk, vk) = zk::setup(seed, &mut rng);
        let pvk = zk::prepare_vk(&vk);

        let proof = zk::prove(&pk, board, salt, c, 5, 5, false, seed, &mut rng);
        let fake = Fr::rand(&mut rng);
        assert!(!zk::verify(&pvk, fake, 5, 5, false, &proof));
    }
}
