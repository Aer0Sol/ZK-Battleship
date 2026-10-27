mod board;
mod circuit;
mod commitment;
mod tests;
mod zk;

use ark_bn254::Fr;
use ark_ff::UniformRand;
use board::{random_board, Board, Cell, Ship, FLEET, GRID};
use rand::rngs::OsRng;
use std::io::{self, Write as _};

fn prompt(msg: &str) -> String {
    print!("{msg}");
    io::stdout().flush().unwrap();
    let mut line = String::new();
    io::stdin().read_line(&mut line).unwrap();
    line.trim().to_string()
}

fn parse_coord(s: &str) -> Option<(u8, u8)> {
    let mut it = s.split_whitespace();
    let r = it.next()?.parse::<u8>().ok()?;
    let c = it.next()?.parse::<u8>().ok()?;
    (r < GRID as u8 && c < GRID as u8).then_some((r, c))
}

fn place_fleet_interactive() -> Board {
    let names = ["Carrier (5)", "Battleship (4)", "Cruiser (3)", "Submarine (3)", "Destroyer (2)"];
    let mut board = Board::new();
    println!("\n=== Place your fleet ===");
    println!("Format: row col h/v  (e.g. 3 4 h)\n");

    for (&len, name) in FLEET.iter().zip(names.iter()) {
        loop {
            println!("{board}");
            let raw = prompt(&format!("Place {name}: "));
            let parts: Vec<&str> = raw.split_whitespace().collect();
            if parts.len() != 3 { println!("Need: row col h|v"); continue; }
            let Ok(row) = parts[0].parse::<usize>() else { println!("Bad row"); continue; };
            let Ok(col) = parts[1].parse::<usize>() else { println!("Bad col"); continue; };
            if row >= GRID || col >= GRID { println!("Out of bounds"); continue; }
            let horiz = match parts[2] {
                "h" | "H" => true, "v" | "V" => false,
                _ => { println!("Use h or v"); continue; }
            };
            match board.place(Ship { row, col, len, horiz }) {
                Ok(_) => break,
                Err(e) => println!("{e}"),
            }
        }
    }
    board
}

fn ai_shot(board: &Board, rng: &mut impl rand::Rng) -> (u8, u8) {
    loop {
        let r = rng.gen_range(0..GRID) as u8;
        let c = rng.gen_range(0..GRID) as u8;
        if matches!(board.cells[r as usize][c as usize], Cell::Empty | Cell::Ship) {
            return (r, c);
        }
    }
}

fn hex_fr(f: &Fr) -> String {
    use ark_ff::{BigInteger, PrimeField};
    f.into_bigint().to_bytes_be().iter().map(|b| format!("{b:02x}")).collect()
}

fn main() {
    let mut rng = OsRng;

    println!("╔════════════════════════════════════════╗");
    println!("║        ZK-BATTLESHIP  (Groth16)        ║");
    println!("╚════════════════════════════════════════╝\n");

    let seed = commitment::public_seed(&mut rng);
    let seed_hex = seed.iter().map(|b| format!("{b:02x}")).collect::<String>();
    println!("[*] Public seed: {seed_hex}");

    println!("[*] Generating Groth16 keys…");
    let (pk, vk) = zk::setup(seed, &mut rng);
    let pvk = zk::prepare_vk(&vk);
    println!("[*] Done.\n");

    let p1_board = place_fleet_interactive();
    let p1_salt = Fr::rand(&mut rng);
    let p1_bits = p1_board.to_bits();
    let p1_commit = commitment::commit(&p1_bits, p1_salt, seed);
    println!("\n[*] Your commitment:      0x{}", hex_fr(&p1_commit));

    let mut p2_board = random_board(&mut rng);
    let p2_salt = Fr::rand(&mut rng);
    let p2_bits = p2_board.to_bits();
    let p2_commit = commitment::commit(&p2_bits, p2_salt, seed);
    println!("[*] Opponent commitment:  0x{}\n", hex_fr(&p2_commit));

    let mut p1_board = p1_board;
    let mut tracking = Board::new();

    println!("=== GAME START ===\n");

    for turn in 1.. {
        println!("\n── Turn {turn} ────────────────────────────────");

        println!("{tracking}");
        let (sr, sc) = loop {
            let raw = prompt("Fire at row col > ");
            match parse_coord(&raw) {
                Some(rc) => break rc,
                None => println!("Enter two numbers 0-9."),
            }
        };

        let hit = p2_board.is_ship(sr as usize, sc as usize);
        let proof = zk::prove(
            &pk,
            p2_bits.clone(),
            p2_salt,
            p2_commit,
            sr,
            sc,
            hit,
            seed,
            &mut rng,
        );

        if !zk::verify(&pvk, p2_commit, sr, sc, hit, &proof) {
            println!("[!] INVALID PROOF");
            std::process::exit(1);
        }
        println!("[ZK ✓] ({sr},{sc}) → {}", if hit { "HIT" } else { "miss" });
        p2_board.record_shot(sr as usize, sc as usize);
        tracking.cells[sr as usize][sc as usize] = if hit { Cell::Hit } else { Cell::Miss };

        if p2_board.all_sunk() {
            println!("\n🎉  You sunk all opponent ships — YOU WIN!\n");
            break;
        }

        let (or, oc) = ai_shot(&p1_board, &mut rng);
        println!("\nOpponent fires at ({or},{oc})");

        let ohit = p1_board.is_ship(or as usize, oc as usize);
        let oproof = zk::prove(
            &pk,
            p1_bits.clone(),
            p1_salt,
            p1_commit,
            or,
            oc,
            ohit,
            seed,
            &mut rng,
        );

        if !zk::verify(&pvk, p1_commit, or, oc, ohit, &oproof) {
            println!("[!] YOUR OWN PROOF IS INVALID");
            std::process::exit(1);
        }
        println!("[ZK ✓] ({or},{oc}) → {}", if ohit { "HIT" } else { "miss" });
        p1_board.record_shot(or as usize, oc as usize);
        println!("\nYour fleet:\n{p1_board}");

        if p1_board.all_sunk() {
            println!("\n💀  All your ships were sunk — OPPONENT WINS.\n");
            break;
        }
    }
}
