use std::fmt;

pub const GRID: usize = 10;
pub const CELLS: usize = GRID * GRID;
pub const FLEET: &[usize] = &[5, 4, 3, 3, 2];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cell { Empty, Ship, Hit, Miss }

#[derive(Debug, Clone)]
pub struct Ship {
    pub row: usize,
    pub col: usize,
    pub len: usize,
    pub horiz: bool,
}

impl Ship {
    pub fn cells(&self) -> Vec<(usize, usize)> {
        (0..self.len)
            .map(|i| if self.horiz { (self.row, self.col + i) } else { (self.row + i, self.col) })
            .collect()
    }

    pub fn in_bounds(&self) -> bool {
        self.cells().iter().all(|&(r, c)| r < GRID && c < GRID)
    }
}

#[derive(Debug, Clone)]
pub struct Board {
    pub cells: [[Cell; GRID]; GRID],
    pub ships: Vec<Ship>,
}

impl Board {
    pub fn new() -> Self {
        Board { cells: [[Cell::Empty; GRID]; GRID], ships: Vec::new() }
    }

    pub fn place(&mut self, ship: Ship) -> Result<(), &'static str> {
        if !ship.in_bounds() { return Err("ship out of bounds"); }
        for &(r, c) in &ship.cells() {
            if self.cells[r][c] == Cell::Ship { return Err("ships overlap"); }
        }
        for &(r, c) in &ship.cells() { self.cells[r][c] = Cell::Ship; }
        self.ships.push(ship);
        Ok(())
    }

    pub fn to_bits(&self) -> Vec<u8> {
        let mut out = vec![0u8; CELLS];
        for r in 0..GRID {
            for c in 0..GRID {
                if self.cells[r][c] == Cell::Ship { out[r * GRID + c] = 1; }
            }
        }
        out
    }

    pub fn is_ship(&self, row: usize, col: usize) -> bool {
        matches!(self.cells[row][col], Cell::Ship | Cell::Hit)
    }

    pub fn record_shot(&mut self, row: usize, col: usize) -> bool {
        let hit = self.cells[row][col] == Cell::Ship;
        self.cells[row][col] = if hit { Cell::Hit } else { Cell::Miss };
        hit
    }

    pub fn all_sunk(&self) -> bool {
        !self.cells.iter().flatten().any(|&c| c == Cell::Ship)
    }
}

impl fmt::Display for Board {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "   ")?;
        for c in 0..GRID { write!(f, "{c} ")?; }
        writeln!(f)?;
        for r in 0..GRID {
            write!(f, "{r:2} ")?;
            for c in 0..GRID {
                let ch = match self.cells[r][c] {
                    Cell::Empty => '.', Cell::Ship => '#',
                    Cell::Hit => 'X', Cell::Miss => 'o',
                };
                write!(f, "{ch} ")?;
            }
            writeln!(f)?;
        }
        Ok(())
    }
}

pub fn random_board(rng: &mut impl rand::Rng) -> Board {
    let mut board = Board::new();
    for &len in FLEET {
        loop {
            let ship = Ship {
                row: rng.gen_range(0..GRID),
                col: rng.gen_range(0..GRID),
                len,
                horiz: rng.gen(),
            };
            if board.place(ship).is_ok() { break; }
        }
    }
    board
}
