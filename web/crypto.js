function chachaQuarterRound(state, a, b, c, d) {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] ^= state[a];
  state[d] = ((state[d] << 16) | (state[d] >>> 16)) >>> 0;

  state[c] = (state[c] + state[d]) >>> 0;
  state[b] ^= state[c];
  state[b] = ((state[b] << 12) | (state[b] >>> 20)) >>> 0;

  state[a] = (state[a] + state[b]) >>> 0;
  state[d] ^= state[a];
  state[d] = ((state[d] << 8) | (state[d] >>> 24)) >>> 0;

  state[c] = (state[c] + state[d]) >>> 0;
  state[b] ^= state[c];
  state[b] = ((state[b] << 7) | (state[b] >>> 25)) >>> 0;
}

function chacha20Block(key, counter, nonce) {
  const constants = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
  const keyWords = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    keyWords[i] = key[i * 4] | (key[i * 4 + 1] << 8) | (key[i * 4 + 2] << 16) | (key[i * 4 + 3] << 24);
  }
  const nonceWords = new Uint32Array(3);
  for (let i = 0; i < 3; i++) {
    nonceWords[i] = nonce[i * 4] | (nonce[i * 4 + 1] << 8) | (nonce[i * 4 + 2] << 16) | (nonce[i * 4 + 3] << 24);
  }

  const state = new Uint32Array([
    ...constants,
    ...keyWords,
    counter >>> 0,
    ...nonceWords,
  ]);
  const working = Uint32Array.from(state);

  for (let round = 0; round < 10; round++) {
    chachaQuarterRound(working, 0, 4, 8, 12);
    chachaQuarterRound(working, 1, 5, 9, 13);
    chachaQuarterRound(working, 2, 6, 10, 14);
    chachaQuarterRound(working, 3, 7, 11, 15);
    chachaQuarterRound(working, 0, 5, 10, 15);
    chachaQuarterRound(working, 1, 6, 11, 12);
    chachaQuarterRound(working, 2, 7, 8, 13);
    chachaQuarterRound(working, 3, 4, 9, 14);
  }

  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const word = (working[i] + state[i]) >>> 0;
    out[i * 4] = word & 0xff;
    out[i * 4 + 1] = (word >>> 8) & 0xff;
    out[i * 4 + 2] = (word >>> 16) & 0xff;
    out[i * 4 + 3] = (word >>> 24) & 0xff;
  }
  return out;
}

function chacha20Xor(key, counter, nonce, data) {
  const out = new Uint8Array(data.length);
  for (let offset = 0; offset < data.length; offset += 64) {
    const block = chacha20Block(key, counter + offset / 64, nonce);
    const chunk = Math.min(64, data.length - offset);
    for (let i = 0; i < chunk; i++) {
      out[offset + i] = data[offset + i] ^ block[i];
    }
  }
  return out;
}

function poly1305Mac(msg, key) {
  const rBytes = key.slice(0, 16);
  const sBytes = key.slice(16, 32);

  rBytes[3] &= 15; rBytes[7] &= 15; rBytes[11] &= 15; rBytes[15] &= 15;
  rBytes[4] &= 252; rBytes[8] &= 252; rBytes[12] &= 252;

  const bytesToBigIntLE = bytes => {
    let value = 0n;
    for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]);
    return value;
  };

  const r = bytesToBigIntLE(rBytes);
  const s = bytesToBigIntLE(sBytes);
  const p = (1n << 130n) - 5n;

  let acc = 0n;
  for (let offset = 0; offset < msg.length; offset += 16) {
    const chunk = msg.slice(offset, offset + 16);
    const padded = new Uint8Array(chunk.length + 1);
    padded.set(chunk);
    padded[chunk.length] = 1;
    acc = (acc + bytesToBigIntLE(padded)) * r % p;
  }
  acc = (acc + s) % (1n << 128n);

  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    tag[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return tag;
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pad16(bytes) {
  const remainder = bytes.length % 16;
  return remainder === 0 ? new Uint8Array(0) : new Uint8Array(16 - remainder);
}

function lengthLE64(n) {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return out;
}

function poly1305Input(aad, ciphertext) {
  return concatBytes(
    aad, pad16(aad),
    ciphertext, pad16(ciphertext),
    lengthLE64(aad.length),
    lengthLE64(ciphertext.length),
  );
}

function chacha20Poly1305Seal(key, nonce, plaintext, aad = new Uint8Array(0)) {
  const otk = chacha20Block(key, 0, nonce).slice(0, 32);
  const ciphertext = chacha20Xor(key, 1, nonce, plaintext);
  const tag = poly1305Mac(poly1305Input(aad, ciphertext), otk);
  return concatBytes(ciphertext, tag);
}

function chacha20Poly1305Open(key, nonce, sealed, aad = new Uint8Array(0)) {
  const ciphertext = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);
  const otk = chacha20Block(key, 0, nonce).slice(0, 32);
  const expected = poly1305Mac(poly1305Input(aad, ciphertext), otk);
  if (!expected.every((byte, i) => byte === tag[i])) {
    throw new Error("authentication failed");
  }
  return chacha20Xor(key, 1, nonce, ciphertext);
}

function nonceFromCounter(counter) {
  const nonce = new Uint8Array(12);
  for (let i = 11; i >= 0; i--) {
    nonce[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  return nonce;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

class SecureChannel {
  constructor(sendKey, recvKey) {
    this.sendKey = sendKey;
    this.recvKey = recvKey;
    this.sendSeq = 0;
    this.recvSeq = 0;
  }

  async encrypt(message) {
    const plaintext = new TextEncoder().encode(JSON.stringify(message));
    const nonce = nonceFromCounter(this.sendSeq);
    this.sendSeq += 1;
    const sealed = chacha20Poly1305Seal(this.sendKey, nonce, plaintext);
    return bytesToBase64(sealed);
  }

  decrypt(payload) {
    const sealed = base64ToBytes(payload);
    const nonce = nonceFromCounter(this.recvSeq);
    this.recvSeq += 1;
    const plaintext = chacha20Poly1305Open(this.recvKey, nonce, sealed);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
}

async function ecdhHandshake(peerPublicKeyBase64) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const ownPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));

  const peerPublicKey = await crypto.subtle.importKey(
    "raw", base64ToBytes(peerPublicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const sharedBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey }, keyPair.privateKey, 256,
  ));

  const master = await sha256(sharedBits);
  const clientKey = await sha256(concatBytes(master, new TextEncoder().encode("client-send")));
  const serverKey = await sha256(concatBytes(master, new TextEncoder().encode("server-send")));

  return {
    ownPublicKeyBase64: bytesToBase64(ownPublicKeyBytes),
    channel: new SecureChannel(clientKey, serverKey),
  };
}
