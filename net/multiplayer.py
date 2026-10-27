#!/usr/bin/env python3
import argparse
import hashlib
import hmac
import json
import os
import queue
import random
import secrets
import socket
import struct
import subprocess
import sys
import threading
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from ecdsa import ECDH, SECP256k1, SigningKey

ROOT        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROVE_JS    = os.path.join(ROOT, "scripts", "prove_for_net.js")
VERIFY_JS   = os.path.join(ROOT, "scripts", "verify_for_net.js")
COMMIT_JS   = os.path.join(ROOT, "scripts", "commit_for_net.js")
VK_PATH     = os.path.join(ROOT, "build", "verification_key.json")
ZKEY_PATH   = os.path.join(ROOT, "build", "shot_final.zkey")

ZK_AVAILABLE = (os.path.isfile(VK_PATH) and os.path.isfile(ZKEY_PATH)
                and os.path.isfile(COMMIT_JS))

GRID  = 10
FLEET = [5, 4, 3, 3, 2]
FLEET_NAMES = ["Carrier (5)", "Battleship (4)", "Cruiser (3)",
               "Submarine (3)", "Destroyer (2)"]

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


def place_fleet_interactive() -> Board:
    b = Board()
    print("\n=== Place your fleet ===")
    print("Format:  row col h|v   (e.g.  3 4 h)\n")
    for length, name in zip(FLEET, FLEET_NAMES):
        while True:
            print(b.show())
            raw = input(f"Place {name}: ").strip().split()
            if len(raw) != 3:
                print("Need:  row col h|v")
                continue
            try:
                row, col = int(raw[0]), int(raw[1])
            except ValueError:
                print("Row/col must be integers 0-9")
                continue
            horiz = raw[2].lower() == "h"
            if not (0 <= row < GRID and 0 <= col < GRID):
                print("Out of bounds")
                continue
            if not b.place(row, col, length, horiz):
                print("Cannot place here — out of bounds or overlapping")
                continue
            break
    return b


def zk_commit(board_bits: list, salt: str) -> Optional[str]:
    if not ZK_AVAILABLE:
        return None
    inp = json.dumps({"board": [str(b) for b in board_bits], "salt": salt})
    try:
        r = subprocess.run(
            ["node", COMMIT_JS],
            input=inp, capture_output=True, text=True, timeout=30,
            cwd=ROOT,
        )
        if r.returncode != 0:
            sys.stderr.write(f"[zk] commit error: {r.stderr.strip()}\n")
            return None
        return r.stdout.strip()
    except Exception as e:
        sys.stderr.write(f"[zk] commit exception: {e}\n")
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
            ["node", PROVE_JS],
            input=inp, capture_output=True, text=True, timeout=120,
            cwd=ROOT,
        )
        if r.returncode != 0:
            sys.stderr.write(f"[zk] prove error: {r.stderr.strip()}\n")
            return None
        return json.loads(r.stdout.strip())
    except Exception as e:
        sys.stderr.write(f"[zk] prove exception: {e}\n")
        return None


def zk_verify(proof: dict, public: list) -> bool:
    inp = json.dumps({"proof": proof, "public": public})
    try:
        r = subprocess.run(
            ["node", VERIFY_JS],
            input=inp, capture_output=True, text=True, timeout=30,
            cwd=ROOT,
        )
        return r.stdout.strip() == "true"
    except Exception as e:
        sys.stderr.write(f"[zk] verify exception: {e}\n")
        return False

MAX_FRAME = 1 << 20
AAD = b"zk-battleship/v1"


def send_frame(sock: socket.socket, data: bytes):
    if len(data) > MAX_FRAME:
        raise ValueError("frame too large")
    sock.sendall(struct.pack(">I", len(data)) + data)


def recv_exact(sock: socket.socket, size: int) -> bytes:
    data = bytearray()
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise ConnectionResetError("peer disconnected")
        data.extend(chunk)
    return bytes(data)


def recv_frame(sock: socket.socket) -> bytes:
    size = struct.unpack(">I", recv_exact(sock, 4))[0]
    if size > MAX_FRAME:
        raise ValueError("frame too large")
    return recv_exact(sock, size)


class Conn:
    def __init__(self, sock: socket.socket, is_client: bool):
        self._sock = sock
        self._q: queue.Queue = queue.Queue()
        self.fingerprint, send_key, recv_key = self._handshake(is_client)
        self._send_cipher = ChaCha20Poly1305(send_key)
        self._recv_cipher = ChaCha20Poly1305(recv_key)
        self._send_seq = 0
        self._recv_seq = 0
        t = threading.Thread(target=self._recv_loop, daemon=True)
        t.start()

    def _handshake(self, is_client: bool) -> tuple[str, bytes, bytes]:
        private_key = SigningKey.generate(
            curve=SECP256k1, entropy=secrets.token_bytes
        )
        public_key = private_key.verifying_key.to_string("compressed")
        if is_client:
            send_frame(self._sock, public_key)
            peer_key = recv_frame(self._sock)
            client_key, server_key = public_key, peer_key
        else:
            peer_key = recv_frame(self._sock)
            send_frame(self._sock, public_key)
            client_key, server_key = peer_key, public_key
        if len(peer_key) != 33:
            raise ValueError("invalid secp256k1 public key")

        ecdh = ECDH(curve=SECP256k1)
        ecdh.load_private_key(private_key)
        ecdh.load_received_public_key_bytes(peer_key, valid_encodings=["compressed"])
        shared_secret = ecdh.generate_sharedsecret_bytes()
        master = hashlib.sha256(
            AAD + shared_secret + client_key + server_key
        ).digest()
        client_tag = hmac.new(master, b"client", hashlib.sha256).digest()
        server_tag = hmac.new(master, b"server", hashlib.sha256).digest()
        if is_client:
            send_frame(self._sock, client_tag)
            if not hmac.compare_digest(recv_frame(self._sock), server_tag):
                raise ValueError("ECDH key confirmation failed")
            send_key, recv_key = b"client-send", b"server-send"
        else:
            if not hmac.compare_digest(recv_frame(self._sock), client_tag):
                raise ValueError("ECDH key confirmation failed")
            send_frame(self._sock, server_tag)
            send_key, recv_key = b"server-send", b"client-send"
        fingerprint = hashlib.sha256(b"fingerprint" + master).hexdigest()
        return (
            fingerprint,
            hashlib.sha256(master + send_key).digest(),
            hashlib.sha256(master + recv_key).digest(),
        )

    def send(self, msg: dict):
        if self._send_seq >= 1 << 96:
            raise OverflowError("send nonce exhausted")
        data = json.dumps(msg, separators=(",", ":")).encode()
        nonce = self._send_seq.to_bytes(12, "big")
        send_frame(self._sock, self._send_cipher.encrypt(nonce, data, AAD))
        self._send_seq += 1

    def recv(self, timeout: float = 300.0) -> dict:
        item = self._q.get(timeout=timeout)
        if isinstance(item, Exception):
            raise item
        return item

    def _recv_loop(self):
        try:
            while True:
                if self._recv_seq >= 1 << 96:
                    raise OverflowError("receive nonce exhausted")
                nonce = self._recv_seq.to_bytes(12, "big")
                data = self._recv_cipher.decrypt(nonce, recv_frame(self._sock), AAD)
                self._recv_seq += 1
                self._q.put(json.loads(data))
        except Exception as e:
            self._q.put(e)

def run_game(conn: Conn, my_board: Board, my_salt: str,
             i_fire_first: bool, my_role: str):

    my_bits       = my_board.to_bits()
    tracking      = Board()
    their_commit  = None

    print(f"\n{'─'*42}")
    print(f"  ZK-Battleship  [{my_role}]  "
          f"{'ZK ON' if ZK_AVAILABLE else 'ZK OFF (trusted mode)'}")
    print(f"{'─'*42}\n")

    local_commit = zk_commit(my_bits, my_salt) if ZK_AVAILABLE else None
    if ZK_AVAILABLE and local_commit is None:
        raise RuntimeError("could not compute Poseidon commitment")

    if i_fire_first:
        conn.send({"type": "commit", "value": local_commit})
        msg = conn.recv()
        assert msg["type"] == "commit"
        their_commit = msg["value"]
    else:
        msg = conn.recv()
        assert msg["type"] == "commit"
        their_commit = msg["value"]
        conn.send({"type": "commit", "value": local_commit})

    if ZK_AVAILABLE and not isinstance(their_commit, str):
        raise RuntimeError("opponent did not provide a Poseidon commitment")
    local_preview = f"{local_commit[:16]}…" if local_commit else "unavailable"
    their_preview = f"{their_commit[:16]}…" if their_commit else "unavailable"
    print(f"[*] Your commitment   : {local_preview}")
    print(f"[*] Opponent commit   : {their_preview}\n")

    fire_now = i_fire_first
    for turn in range(1, 201):
        print(f"── Turn {turn} {'(your shot)' if fire_now else '(opponent fires)'} "
              + "─" * 20)

        if fire_now:
            print("Opponent's grid (your view):")
            print(tracking.show())
            while True:
                raw = input("Fire at row col > ").strip().split()
                if len(raw) != 2:
                    continue
                try:
                    sr, sc = int(raw[0]), int(raw[1])
                except ValueError:
                    continue
                if 0 <= sr < GRID and 0 <= sc < GRID:
                    break

            conn.send({"type": "shot", "row": sr, "col": sc})

            msg = conn.recv()
            if msg["type"] == "game_over":
                print(f"\n💀  {msg['winner']} wins.  You lose.")
                break
            assert msg["type"] == "result", f"unexpected: {msg}"
            is_hit = bool(int(msg["is_hit"]))

            if msg.get("proof"):
                public = msg.get("public")
                expected = [their_commit, str(sr), str(sc), msg["is_hit"]]
                ok = (isinstance(public, list)
                      and [str(v) for v in public] == expected
                      and zk_verify(msg["proof"], public))
                status = "[ZK ✓]" if ok else "[ZK ✗ — CHEAT DETECTED]"
                if not ok:
                    print(f"\n{status} Opponent's proof is INVALID!")
                    conn.send({"type": "cheat_detected"})
                    sys.exit(1)
            else:
                if ZK_AVAILABLE:
                    raise RuntimeError("opponent failed to provide a ZK proof")
                status = "[trusted]"

            print(f"{status} ({sr},{sc}) → {'HIT' if is_hit else 'miss'}")
            tracking.cells[sr][sc] = HIT if is_hit else MISS

            hits = sum(
                1 for r in range(GRID) for c in range(GRID)
                if tracking.cells[r][c] == HIT
            )
            if hits >= 17:
                print("\n🎉  You sank all opponent ships — YOU WIN!")
                conn.send({"type": "game_over", "winner": my_role})
                break

        else:
            msg = conn.recv()
            if msg["type"] == "game_over":
                print(f"\n💀  {msg['winner']} wins.  You lose.")
                break
            if msg["type"] == "cheat_detected":
                print("\n[!] Opponent flagged your proof as invalid.")
                sys.exit(1)
            assert msg["type"] == "shot", f"unexpected: {msg}"
            sr, sc = int(msg["row"]), int(msg["col"])
            print(f"Opponent fires at ({sr}, {sc})")

            is_hit_now = my_board.is_ship(sr, sc)

            zk_result = zk_prove(my_bits, my_salt, sr, sc)

            if zk_result:
                public = zk_result.get("public")
                expected = [local_commit, str(sr), str(sc), zk_result["is_hit"]]
                if ([str(v) for v in public] != expected
                        or zk_result["is_hit"] != str(int(is_hit_now))):
                    raise RuntimeError("proof public inputs do not match the game state")
                conn.send({
                    "type":   "result",
                    "is_hit": zk_result["is_hit"],
                    "proof":  zk_result["proof"],
                    "public": public,
                })
                print(f"[ZK] Proof sent for ({sr},{sc}) → "
                      f"{'HIT' if is_hit_now else 'miss'}")
            else:
                if ZK_AVAILABLE:
                    raise RuntimeError("could not generate ZK proof")
                conn.send({
                    "type":   "result",
                    "is_hit": str(int(is_hit_now)),
                })
                print(f"[trusted] ({sr},{sc}) → {'HIT' if is_hit_now else 'miss'}")

            my_board.record(sr, sc)

            print("\nYour fleet:")
            print(my_board.show())

            if my_board.all_sunk():
                print("\n💀  All your ships were sunk — OPPONENT WINS.")
                break

        fire_now = not fire_now

def run_server(port: int):
    my_board = place_fleet_interactive()
    salt = str(secrets.randbits(248))

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", port))
    srv.listen(1)

    print(f"\n[*] Fleet placed. Listening on 0.0.0.0:{port}")
    print(f"[*] Share your tunnel address with your opponent and tell them to connect now.\n")
    print("Waiting for opponent to connect…")

    sock, addr = srv.accept()
    srv.close()
    print(f"[*] Connected: {addr}\n")

    conn = Conn(sock, is_client=False)
    print(f"[*] Secure-channel fingerprint: {conn.fingerprint}")
    input("[*] Compare it with your opponent, then press Enter to continue. ")
    run_game(conn, my_board, salt, i_fire_first=False, my_role="server")

def run_client(host: str, port: int):
    my_board = place_fleet_interactive()
    salt = str(secrets.randbits(248))

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    print(f"\n[*] Fleet placed. Connecting to {host}:{port} …")
    sock.connect((host, port))
    print(f"[*] Connected.\n")

    conn = Conn(sock, is_client=True)
    print(f"[*] Secure-channel fingerprint: {conn.fingerprint}")
    input("[*] Compare it with your opponent, then press Enter to continue. ")
    run_game(conn, my_board, salt, i_fire_first=True, my_role="client")

def main():
    p = argparse.ArgumentParser(
        description="ZK-Battleship multiplayer (playit.gg tunnel ready)"
    )
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--host",  action="store_true",
                      help="host a game (server)")
    mode.add_argument("--join",  metavar="HOST:PORT",
                      help="join a game (client)")
    p.add_argument("--port", type=int, default=7654,
                   help="TCP port when hosting (default: 7654)")
    args = p.parse_args()

    if not ZK_AVAILABLE:
        print("[!] ZK proofs disabled — run  scripts/setup.sh  to enable them.")
        print("    Continuing in trusted mode.\n")

    if args.host:
        run_server(args.port)
    else:
        try:
            host, port_str = args.join.rsplit(":", 1)
            port = int(port_str)
        except ValueError:
            p.error("--join expects  host:port")
        run_client(host, port)


if __name__ == "__main__":
    main()
