/**
 * All cryptography for the DM system lives here and runs only in the browser.
 * The server never sees plaintext or private keys — it stores and relays opaque blobs.
 *
 * Identity:
 *   - ECDSA P-256 keypair  → signing + identity
 *   - ECDH  P-256 keypair  → encryption key exchange
 *   - identityHash = SHA-256(canonical ECDSA public key JWK)  ← used as the chat "secret"
 *     so the server derives:  signature = SHA-256(secret) = identityHash  ✓
 *
 * DM encryption:
 *   - Shared AES-256-GCM key derived via ECDH(myPriv, theirPub)
 *   - Message authenticated by ECDSA signature over (from ‖ to ‖ ciphertext ‖ iv)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Identity {
  ecdsaKeyPair: CryptoKeyPair;
  ecdhKeyPair: CryptoKeyPair;
  /** SHA-256 of the canonical ECDSA public key JWK — 64 hex chars. Also used as the chat room "secret". */
  identityHash: string;
  /** Canonical ECDSA public key JWK (deterministic JSON). Sent as chat secret so server signature == identityHash. */
  ecdsaPubJwkCanonical: string;
  /** Full ECDH public key JWK string — registered in the DM mailbox for encryption. */
  ecdhPubJwk: string;
}

export interface EncryptedDm {
  ciphertext: string; // base64 AES-GCM ciphertext
  iv: string;         // base64 96-bit IV
  sig: string;        // base64 ECDSA signature over (from ‖ to ‖ ciphertext ‖ iv)
}

// ─── Algorithms ──────────────────────────────────────────────────────────────

const ECDSA_ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDH_ALG = { name: 'ECDH', namedCurve: 'P-256' } as const;
const AES_ALG = { name: 'AES-GCM', length: 256 } as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buf2b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b642buf(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Only the key-material fields — makes the hash deterministic regardless of key_ops/ext. */
function canonicalEcPubJwk(jwk: JsonWebKey): string {
  return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
}

export async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Identity lifecycle ───────────────────────────────────────────────────────

const STORAGE_KEY = 'dm_identity_v1';

type StoredIdentity = { ecdsaPub: string; ecdsaPriv: string; ecdhPub: string; ecdhPriv: string };

export async function getOrCreateIdentity(): Promise<Identity> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return await deserializeIdentity(JSON.parse(raw) as StoredIdentity);
    } catch {
      // corrupted — fall through to generate fresh
    }
  }
  return generateIdentity();
}

async function generateIdentity(): Promise<Identity> {
  const [ecdsaKP, ecdhKP] = await Promise.all([
    crypto.subtle.generateKey(ECDSA_ALG, true, ['sign', 'verify']),
    crypto.subtle.generateKey(ECDH_ALG, true, ['deriveKey']),
  ]);

  const [ecdsaPubJwk, ecdsaPrivJwk, ecdhPubJwk, ecdhPrivJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', ecdsaKP.publicKey),
    crypto.subtle.exportKey('jwk', ecdsaKP.privateKey),
    crypto.subtle.exportKey('jwk', ecdhKP.publicKey),
    crypto.subtle.exportKey('jwk', ecdhKP.privateKey),
  ]);

  const ecdsaPubJwkCanonical = canonicalEcPubJwk(ecdsaPubJwk);
  const identityHash = await sha256hex(ecdsaPubJwkCanonical);

  const stored: StoredIdentity = {
    ecdsaPub: JSON.stringify(ecdsaPubJwk),
    ecdsaPriv: JSON.stringify(ecdsaPrivJwk),
    ecdhPub: JSON.stringify(ecdhPubJwk),
    ecdhPriv: JSON.stringify(ecdhPrivJwk),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

  return {
    ecdsaKeyPair: ecdsaKP,
    ecdhKeyPair: ecdhKP,
    identityHash,
    ecdsaPubJwkCanonical,
    ecdhPubJwk: JSON.stringify(ecdhPubJwk),
  };
}

async function deserializeIdentity(s: StoredIdentity): Promise<Identity> {
  const [ecdsaPub, ecdsaPriv, ecdhPub, ecdhPriv] = await Promise.all([
    crypto.subtle.importKey('jwk', JSON.parse(s.ecdsaPub), ECDSA_ALG, true, ['verify']),
    crypto.subtle.importKey('jwk', JSON.parse(s.ecdsaPriv), ECDSA_ALG, true, ['sign']),
    crypto.subtle.importKey('jwk', JSON.parse(s.ecdhPub), ECDH_ALG, true, []),
    crypto.subtle.importKey('jwk', JSON.parse(s.ecdhPriv), ECDH_ALG, true, ['deriveKey']),
  ]);

  const ecdsaPubJwkCanonical = canonicalEcPubJwk(JSON.parse(s.ecdsaPub) as JsonWebKey);
  const identityHash = await sha256hex(ecdsaPubJwkCanonical);

  return {
    ecdsaKeyPair: { publicKey: ecdsaPub, privateKey: ecdsaPriv },
    ecdhKeyPair: { publicKey: ecdhPub, privateKey: ecdhPriv },
    identityHash,
    ecdsaPubJwkCanonical,
    ecdhPubJwk: s.ecdhPub,
  };
}

// ─── Encryption / Decryption ─────────────────────────────────────────────────

async function deriveAesKey(myEcdhPriv: CryptoKey, theirEcdhPubJwk: string): Promise<CryptoKey> {
  const theirPub = await crypto.subtle.importKey('jwk', JSON.parse(theirEcdhPubJwk) as JsonWebKey, ECDH_ALG, false, []);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPub },
    myEcdhPriv,
    AES_ALG,
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt plaintext for a recipient and sign with the sender's ECDSA key. */
export async function encryptDm(
  plaintext: string,
  to: string,
  recipientEcdhPubJwk: string,
  identity: Identity,
): Promise<EncryptedDm> {
  const aesKey = await deriveAesKey(identity.ecdhKeyPair.privateKey, recipientEcdhPubJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc(plaintext));

  const ciphertext = buf2b64(ciphertextBuf);
  const ivB64 = buf2b64(iv);

  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.ecdsaKeyPair.privateKey,
    enc(identity.identityHash + to + ciphertext + ivB64),
  );

  return { ciphertext, iv: ivB64, sig: buf2b64(sigBuf) };
}

/** Decrypt a DM sent by a peer. Throws if decryption fails. */
export async function decryptDm(
  ciphertext: string,
  iv: string,
  senderEcdhPubJwk: string,
  identity: Identity,
): Promise<string> {
  const aesKey = await deriveAesKey(identity.ecdhKeyPair.privateKey, senderEcdhPubJwk);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b642buf(iv) }, aesKey, b642buf(ciphertext));
  return new TextDecoder().decode(plainBuf);
}

/** Verify the ECDSA signature on a received DM. Returns false on any error. */
export async function verifyDm(
  from: string,
  to: string,
  ciphertext: string,
  iv: string,
  sig: string,
  senderEcdsaPubJwk: string,
): Promise<boolean> {
  try {
    const senderPub = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(senderEcdsaPubJwk) as JsonWebKey,
      ECDSA_ALG,
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      senderPub,
      b642buf(sig),
      enc(from + to + ciphertext + iv),
    );
  } catch {
    return false;
  }
}
