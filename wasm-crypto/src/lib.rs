use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use std::mem;

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// # Safety
/// `key_ptr` must point to 32 readable bytes, `nonce_ptr` to 12, `pt_ptr` to `pt_len`
/// bytes, and `out_ptr` to `pt_len + 16` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn seal(
    key_ptr: *const u8,
    nonce_ptr: *const u8,
    pt_ptr: *const u8,
    pt_len: usize,
    out_ptr: *mut u8,
) -> i32 {
    let key = Key::from_slice(std::slice::from_raw_parts(key_ptr, 32));
    let nonce = Nonce::from_slice(std::slice::from_raw_parts(nonce_ptr, 12));
    let plaintext = std::slice::from_raw_parts(pt_ptr, pt_len);
    let cipher = ChaCha20Poly1305::new(key);
    match cipher.encrypt(nonce, plaintext) {
        Ok(sealed) => {
            std::slice::from_raw_parts_mut(out_ptr, pt_len + 16).copy_from_slice(&sealed);
            0
        }
        Err(_) => 1,
    }
}

/// # Safety
/// `key_ptr` must point to 32 readable bytes, `nonce_ptr` to 12, `ct_ptr` to `ct_len`
/// bytes (ciphertext plus 16-byte tag), and `out_ptr` to `ct_len - 16` writable bytes.
#[no_mangle]
pub unsafe extern "C" fn open(
    key_ptr: *const u8,
    nonce_ptr: *const u8,
    ct_ptr: *const u8,
    ct_len: usize,
    out_ptr: *mut u8,
) -> i32 {
    if ct_len < 16 {
        return 1;
    }
    let key = Key::from_slice(std::slice::from_raw_parts(key_ptr, 32));
    let nonce = Nonce::from_slice(std::slice::from_raw_parts(nonce_ptr, 12));
    let sealed = std::slice::from_raw_parts(ct_ptr, ct_len);
    let cipher = ChaCha20Poly1305::new(key);
    match cipher.decrypt(nonce, sealed) {
        Ok(plaintext) => {
            std::slice::from_raw_parts_mut(out_ptr, ct_len - 16).copy_from_slice(&plaintext);
            0
        }
        Err(_) => 1,
    }
}
