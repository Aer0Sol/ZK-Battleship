#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import random
import secrets
import subprocess
import sys
from typing import Optional

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives import serialization

ROOT       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_BIN = os.path.join(ROOT, "target", "release", "zk-battleship")
SEED_PATH  = os.path.join(ROOT, "build", "rust", "seed.bin")
PK_PATH    = os.path.join(ROOT, "build", "rust", "proving_key.bin")
VK_PATH    = os.path.join(ROOT, "build", "rust", "verifying_key.bin")

ZK_AVAILABLE = (os.path.isfile(ENGINE_BIN) and os.path.isfile(SEED_PATH)
                and os.path.isfile(PK_PATH) and os.path.isfile(VK_PATH))

GRID  = 10
FLEET = [5, 4, 3, 3, 2]

EMPTY, SHIP, HIT, MISS = 0, 1, 2, 3
SYM = {EMPTY: ".", SHIP: "#", HIT: "X", MISS: "o"}


class Board:
    def __init__(self):
        self.cells = [[EMPTY] * GRID for _ in range(GRID)]

    def place(self, row: int, col: int, length: int, horiz: bool) -> bool:
        cells = [(row, col + i) if horiz else (row + i, col)
                 for i in range(length)]
        if any(r >= GRID or c >= GRID or self.cells[r][c] == SHIP
               for r, c in cells):
            return False
        for r, c in cells:
            self.cells[r][c] = SHIP
        return True

    def is_ship(self, row: int, col: int) -> bool:
        return self.cells[row][col] in (SHIP, HIT)

    def record(self, row: int, col: int) -> bool:
        hit = self.cells[row][col] == SHIP
        self.cells[row][col] = HIT if hit else MISS
        return hit

    def all_sunk(self) -> bool:
        return not any(self.cells[r][c] == SHIP
                       for r in range(GRID) for c in range(GRID))

    def to_bits(self) -> list:
        return [1 if self.cells[r][c] == SHIP else 0
                for r in range(GRID) for c in range(GRID)]

    def show(self, hide_ships=False) -> str:
        lines = ["   " + " ".join(str(c) for c in range(GRID))]
        for r in range(GRID):
            row_str = []
            for c in range(GRID):
                cell = self.cells[r][c]
                if hide_ships and cell == SHIP:
                    row_str.append(".")
                else:
                    row_str.append(SYM[cell])
            lines.append(f"{r:2} " + " ".join(row_str))
        return "\n".join(lines)


def random_board() -> Board:
    b = Board()
    for length in FLEET:
        while True:
            r, c   = random.randrange(GRID), random.randrange(GRID)
            horiz  = random.random() < 0.5
            if b.place(r, c, length, horiz):
                break
    return b


def zk_commit(board_bits: list, salt: str) -> Optional[str]:
    if not ZK_AVAILABLE:
        return None
    inp = json.dumps({"board": [str(b) for b in board_bits], "salt": salt})
    try:
        r = subprocess.run(
            [ENGINE_BIN, "commit"],
            input=inp, capture_output=True, text=True, timeout=30,
            cwd=ROOT,
        )
        if r.returncode != 0:
            sys.stderr.write(f"commit error: {r.stderr.strip()}\n")
            return None
        return r.stdout.strip()
    except Exception as e:
        sys.stderr.write(f"commit error: {e}\n")
        return None


def zk_prove(board_bits: list, salt: str, row: int, col: int) -> Optional[dict]:
    if not ZK_AVAILABLE:
        return None
    inp = json.dumps({
        "board":    [str(b) for b in board_bits],
        "salt":     salt,
        "shot_row": str(row),
        "shot_col": str(col),
    })
    try:
        r = subprocess.run(
            [ENGINE_BIN, "prove"],
            input=inp, capture_output=True, text=True, timeout=120,
            cwd=ROOT,
        )
        if r.returncode != 0:
            sys.stderr.write(f"prove error: {r.stderr.strip()}\n")
            return None
        return json.loads(r.stdout.strip())
    except Exception as e:
        sys.stderr.write(f"prove error: {e}\n")
        return None


def zk_verify(proof: dict, public: list) -> bool:
    inp = json.dumps({"proof": proof, "public": public})
    try:
        r = subprocess.run(
            [ENGINE_BIN, "verify"],
            input=inp, capture_output=True, text=True, timeout=30,
            cwd=ROOT,
        )
        return r.stdout.strip() == "true"
    except Exception as e:
        sys.stderr.write(f"verify error: {e}\n")
        return False


CURVE = ec.SECP256R1()


def generate_ecdh_keypair():
    private_key = ec.generate_private_key(CURVE)
    public_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return private_key, public_bytes


def derive_channel_keys(private_key, peer_public_bytes: bytes):
    peer_public_key = ec.EllipticCurvePublicKey.from_encoded_point(CURVE, peer_public_bytes)
    shared_secret = private_key.exchange(ec.ECDH(), peer_public_key)
    master = hashlib.sha256(shared_secret).digest()
    client_key = hashlib.sha256(master + b"client-send").digest()
    server_key = hashlib.sha256(master + b"server-send").digest()
    return client_key, server_key


class Channel:
    def __init__(self, send_key: bytes, recv_key: bytes):
        self._send_cipher = ChaCha20Poly1305(send_key)
        self._recv_cipher = ChaCha20Poly1305(recv_key)
        self._send_seq = 0
        self._recv_seq = 0

    def encrypt(self, message: dict) -> str:
        data = json.dumps(message, separators=(",", ":")).encode()
        nonce = self._send_seq.to_bytes(12, "big")
        ct = self._send_cipher.encrypt(nonce, data, None)
        self._send_seq += 1
        return base64.b64encode(ct).decode()

    def decrypt(self, payload: str) -> dict:
        ct = base64.b64decode(payload)
        nonce = self._recv_seq.to_bytes(12, "big")
        data = self._recv_cipher.decrypt(nonce, ct, None)
        self._recv_seq += 1
        return json.loads(data)


def debug_self_test():
    if not ZK_AVAILABLE:
        print("zk build not found, run scripts/setup.sh first")
        return

    board = random_board()
    bits = board.to_bits()
    salt = str(secrets.randbits(248))

    print("board:")
    print(board.show())

    commitment = zk_commit(bits, salt)
    if commitment is None:
        print("commit failed")
        return
    print("commitment:", commitment)

    row, col = 0, 0
    result = zk_prove(bits, salt, row, col)
    if not result:
        print("prove failed")
        return

    hit = result["is_hit"] == "1"
    print(f"shot at ({row},{col}): {'hit' if hit else 'miss'}")

    ok = zk_verify(result["proof"], result["public"])
    print("proof valid:", ok)


if __name__ == "__main__":
    debug_self_test()
