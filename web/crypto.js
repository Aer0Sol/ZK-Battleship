let cipherEnginePromise = null;

function loadCipherEngine() {
  if (!cipherEnginePromise) {
    cipherEnginePromise = fetch("crypto_engine.wasm")
      .then(response => response.arrayBuffer())
      .then(bytes => WebAssembly.instantiate(bytes, {}))
      .then(result => result.instance);
  }
  return cipherEnginePromise;
}

function writeBytes(instance, bytes) {
  const ptr = instance.exports.alloc(bytes.length);
  new Uint8Array(instance.exports.memory.buffer, ptr, bytes.length).set(bytes);
  return ptr;
}

function readBytes(instance, ptr, len) {
  return new Uint8Array(instance.exports.memory.buffer, ptr, len).slice();
}

async function chacha20Poly1305Seal(key, nonce, plaintext) {
  const instance = await loadCipherEngine();
  const keyPtr = writeBytes(instance, key);
  const noncePtr = writeBytes(instance, nonce);
  const ptPtr = writeBytes(instance, plaintext);
  const outLen = plaintext.length + 16;
  const outPtr = instance.exports.alloc(outLen);

  const status = instance.exports.seal(keyPtr, noncePtr, ptPtr, plaintext.length, outPtr);
  const sealed = readBytes(instance, outPtr, outLen);

  instance.exports.dealloc(keyPtr, key.length);
  instance.exports.dealloc(noncePtr, nonce.length);
  instance.exports.dealloc(ptPtr, plaintext.length);
  instance.exports.dealloc(outPtr, outLen);

  if (status !== 0) throw new Error("seal failed");
  return sealed;
}

async function chacha20Poly1305Open(key, nonce, sealed) {
  const instance = await loadCipherEngine();
  const keyPtr = writeBytes(instance, key);
  const noncePtr = writeBytes(instance, nonce);
  const ctPtr = writeBytes(instance, sealed);
  const outLen = sealed.length - 16;
  const outPtr = instance.exports.alloc(outLen);

  const status = instance.exports.open(keyPtr, noncePtr, ctPtr, sealed.length, outPtr);
  const plaintext = readBytes(instance, outPtr, outLen);

  instance.exports.dealloc(keyPtr, key.length);
  instance.exports.dealloc(noncePtr, nonce.length);
  instance.exports.dealloc(ctPtr, sealed.length);
  instance.exports.dealloc(outPtr, outLen);

  if (status !== 0) throw new Error("authentication failed");
  return plaintext;
}

function nonceFromCounter(counter) {
  const nonce = new Uint8Array(12);
  for (let i = 11; i >= 0; i--) {
    nonce[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  return nonce;
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
    const sealed = await chacha20Poly1305Seal(this.sendKey, nonce, plaintext);
    return bytesToBase64(sealed);
  }

  async decrypt(payload) {
    const sealed = base64ToBytes(payload);
    const nonce = nonceFromCounter(this.recvSeq);
    this.recvSeq += 1;
    const plaintext = await chacha20Poly1305Open(this.recvKey, nonce, sealed);
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
