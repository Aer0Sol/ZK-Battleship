use ark_bn254::Fr;
use ark_ff::One;
use ark_r1cs_std::fields::fp::FpVar;
use ark_r1cs_std::prelude::*;
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};

use crate::commitment::randomness;

pub struct ShotCircuit {
    pub board: Option<Vec<u8>>,
    pub salt: Option<Fr>,
    pub commitment: Option<Fr>,
    pub shot_row: Option<u8>,
    pub shot_col: Option<u8>,
    pub is_hit: Option<bool>,
    pub seed: [u8; 32],
}

impl ShotCircuit {
    pub fn blank(seed: [u8; 32]) -> Self {
        Self {
            board: None,
            salt: None,
            commitment: None,
            shot_row: None,
            shot_col: None,
            is_hit: None,
            seed,
        }
    }
}

impl ConstraintSynthesizer<Fr> for ShotCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let board_vars: Vec<FpVar<Fr>> = (0..100)
            .map(|i| {
                FpVar::new_witness(cs.clone(), || {
                    self.board.as_deref()
                        .and_then(|b| b.get(i))
                        .map(|&v| Fr::from(v as u64))
                        .ok_or(SynthesisError::AssignmentMissing)
                })
            })
            .collect::<Result<_, _>>()?;

        for cell in &board_vars {
            (cell * &(FpVar::constant(Fr::one()) - cell)).enforce_equal(&FpVar::zero())?;
        }

        let salt_var = FpVar::new_witness(cs.clone(), || {
            self.salt.ok_or(SynthesisError::AssignmentMissing)
        })?;
        let r = randomness(self.seed);
        let mut computed = FpVar::<Fr>::zero();
        for (i, cell) in board_vars.iter().enumerate() {
            computed = computed + cell * FpVar::constant(r[i]);
        }
        computed = computed + &salt_var * FpVar::constant(r[100]);
        FpVar::new_input(cs.clone(), || {
            self.commitment.ok_or(SynthesisError::AssignmentMissing)
        })?.enforce_equal(&computed)?;

        let pub_row = FpVar::new_input(cs.clone(), || {
            self.shot_row
                .map(|v| Fr::from(v as u64))
                .ok_or(SynthesisError::AssignmentMissing)
        })?;
        let pub_col = FpVar::new_input(cs.clone(), || {
            self.shot_col
                .map(|v| Fr::from(v as u64))
                .ok_or(SynthesisError::AssignmentMissing)
        })?;
        let pub_hit = FpVar::new_input(cs.clone(), || {
            self.is_hit
                .map(|v| Fr::from(v as u64))
                .ok_or(SynthesisError::AssignmentMissing)
        })?;

        let target = &pub_row * &FpVar::constant(Fr::from(10u64)) + &pub_col;
        let mut selected = FpVar::<Fr>::zero();
        for (i, cell) in board_vars.iter().enumerate() {
            let is_i: Boolean<Fr> = target.is_eq(&FpVar::constant(Fr::from(i as u64)))?;
            selected = selected + is_i.select(cell, &FpVar::zero())?;
        }
        selected.enforce_equal(&pub_hit)?;

        Ok(())
    }
}
