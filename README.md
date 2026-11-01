# ZK-Battleship

Battleship, but every shot comes with a zero-knowledge proof instead of just someone's word.
When you fire, your opponent tells you "hit" or "miss" and proves it against their board
without ever showing you the board. So you can trust the result without trusting them.

This was a small project to learn how Groth16 actually works, by implementing it instead of
just reading about it and to just get some hands of experience at using a proof system. The game itself is really just an excuse to have something worth proving.

The game is played in the browser. Rust is the engine: it owns the circuit, the commitment
scheme, and proving/verifying, all exposed as a small command-line tool. Python never does any
of that math itself, it's only there for the multiplayer side: `web/server.py` runs the match
over a websocket and calls out to the Rust binary whenever it needs a commitment, a proof, or a
verification.

## Play

```
bash scripts/setup_rust.sh
pip install -r requirements.txt
python3 web/server.py
```

Then open `http://localhost:8080`.

## Debugging

`net/multiplayer.py` can be run on its own to check that commit, prove, and verify work:

```
python3 net/multiplayer.py
```

This doesn't play a match, it just builds a random board and runs one shot through the Rust
engine so you can see the commitment and proof without opening a browser. You can also talk to
the engine directly, no Python involved:

```
echo '{"board": [...], "salt": "123..."}' | ./target/release/zk-battleship commit
```

`zk-battleship` takes four subcommands: `setup` (run once, generates and saves the Groth16 keys),
`commit`, `prove`, and `verify`. Each one reads a JSON object from stdin and writes its result to
stdout, which is exactly the contract `net/multiplayer.py` calls over `subprocess`.

## Under the hood

The server (`web/server.py`) is built on `aiohttp`, so it's all `asyncio` under the hood: each
browser that connects gets its own coroutine handling the websocket, and the slow parts (calling
out to the Rust engine to prove or verify) get pushed onto a thread with `asyncio.to_thread` so
they don't block anyone else's connection.

Every message on that websocket is end-to-end encrypted between the browser and the server, the
same way the old terminal version encrypted the link between two players. When a client connects,
server and browser each generate an ECDH key pair (P-256), exchange public keys, and derive a
shared secret:

$$ Z = \mathrm{ECDH}(sk_{\text{client}}, pk_{\text{server}}) = \mathrm{ECDH}(sk_{\text{server}}, pk_{\text{client}}) $$

That shared secret is hashed into a master key, and the master key is hashed again with two
different labels to get one key per direction, so the client and the server are never encrypting
with the same key:

$$ K_{\text{master}} = \mathrm{SHA256}(Z), \qquad K_{\text{client}} = \mathrm{SHA256}(K_{\text{master}} \,\|\, \texttt{"client-send"}), \qquad K_{\text{server}} = \mathrm{SHA256}(K_{\text{master}} \,\|\, \texttt{"server-send"}) $$

From there every message is sealed with ChaCha20-Poly1305 before it goes on the wire, with the
nonce just counting up per direction so it's never reused. On the Python side that's the
`cryptography` library; the browser doesn't have ChaCha20-Poly1305 built in (the Web Crypto API
only ships AES), so `web/crypto.js` implements ChaCha20 and Poly1305 directly from RFC 8439,
and ECDH itself uses the browser's native `crypto.subtle`.

The proof side is Groth16, over the circuit in `src/circuit.rs` (`arkworks`, curve BN254). The
`setup` subcommand picks a random 32-byte seed once and saves it alongside the proving and
verifying keys in `build/rust/`; every match the server runs afterward reuses that same seed to
derive a deterministic PRNG producing 101 field elements $r_0, \dots, r_{100}$.
Committing to a board is just a random linear combination of its 100 cells against that public
randomness, blinded by a secret salt along one extra random direction:

$$ C = \sum_{i=0}^{99} b_i \, r_i \; + \; s \, r_{100} $$

where $b$ is the 100 board cells (0 or 1) and $s$ is a random salt only the board's owner knows.
Since $r$ is public, nothing here is hidden by the hashing you'd get from a real hash function;
it's the secret salt term that keeps $C$ from leaking the board. When you fire a shot, the
defender proves, without revealing $b$ or $s$, that they know values matching that commitment,
that the board is a legal fleet ($\sum_i b_i = 17$), and that the cell you shot at really does
equal the hit/miss they're claiming:

$$ b_{\text{row} \cdot 10 + \text{col}} = \text{isHit} $$

Groth16 turns that into a short, constant-size proof that the engine's own `verify` subcommand
checks in milliseconds. So the math does the work and you need not rely simply on trust.

`circuits/shot.circom` is a separate, earlier attempt at the same circuit using circom and
snarkjs, with a Poseidon-hash commitment instead. It still works as a standalone proof of
concept (`scripts/setup.sh` and `scripts/demo.sh`), it's just not what the live game runs on.
