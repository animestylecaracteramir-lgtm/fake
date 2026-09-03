import crypto from 'crypto';

// X25519 DER PKCS#8 prefix: 16 bytes identifying curve25519 private key
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
// X25519 DER SPKI prefix: 12 bytes identifying curve25519 public key
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

const PLACEHOLDER_PATTERNS = [
  /SERVER_PRIVATE_KEY_REQUIRED/i,
  /SERVER_PUBLIC_KEY/i,
  /PLACEHOLDER/i,
  /REQUIRED/i,
  /FAKE/i,
  /EXAMPLE/i,
  /xxxx/i,
  /TEST_KEY/i,
  /YOUR_PRIVATE_KEY/i,
  /YOUR_PUBLIC_KEY/i,
  /CHANGEME/i,
  /SECRET_KEY/i,
];

/**
 * Check if a string matches common placeholder patterns.
 */
export function isPlaceholderString(value: string | undefined | null): boolean {
  if (!value || typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Normalizes a base64 or base64url string to raw 32-byte Buffer.
 */
export function decodeKeyToBuffer(keyStr: string): Buffer | null {
  if (!keyStr || typeof keyStr !== 'string') return null;
  const trimmed = keyStr.trim();
  if (isPlaceholderString(trimmed)) return null;

  try {
    // If it is 64-char hex string
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    // Try base64url / standard base64
    let b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
      b64 += '=';
    }

    const buf = Buffer.from(b64, 'base64');
    if (buf.length === 32) {
      return buf;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Encodes a 32-byte Buffer to standard unpadded base64url (Xray Reality format).
 */
export function encodeKeyToBase64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * Generate a genuine X25519 keypair for Xray REALITY.
 */
export function generateRealityKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey } = crypto.generateKeyPairSync('x25519');
  const jwk = privateKey.export({ format: 'jwk' });

  if (!jwk.d || !jwk.x) {
    throw new Error('Failed to export X25519 keypair JWK components');
  }

  // JWK d and x are unpadded base64url of the 32-byte private and public scalars
  return {
    privateKey: jwk.d,
    publicKey: jwk.x,
  };
}

/**
 * Derive the corresponding X25519 public key from a given private key.
 */
export function derivePublicKey(privateKeyStr: string): string | null {
  const privBuf = decodeKeyToBuffer(privateKeyStr);
  if (!privBuf || privBuf.length !== 32) {
    return null;
  }

  try {
    const fullPkcs8 = Buffer.concat([X25519_PKCS8_PREFIX, privBuf]);
    const privKeyObj = crypto.createPrivateKey({ key: fullPkcs8, format: 'der', type: 'pkcs8' });
    const pubKeyObj = crypto.createPublicKey(privKeyObj);
    const spki = pubKeyObj.export({ format: 'der', type: 'spki' });
    const rawPub = spki.subarray(spki.length - 32);
    return encodeKeyToBase64Url(rawPub);
  } catch {
    return null;
  }
}

/**
 * Verify whether a client public key corresponds to a server private key.
 */
export function verifyRealityKeyPair(privateKeyStr: string, publicKeyStr: string): boolean {
  const derived = derivePublicKey(privateKeyStr);
  if (!derived) return false;

  const derivedBuf = decodeKeyToBuffer(derived);
  const targetBuf = decodeKeyToBuffer(publicKeyStr);

  if (!derivedBuf || !targetBuf) return false;
  return derivedBuf.equals(targetBuf);
}

/**
 * Classify the state of a REALITY key.
 */
export function classifyRealityKey(
  key: string | undefined | null
): 'missing' | 'placeholder' | 'malformed' | 'valid-looking' {
  if (!key || typeof key !== 'string' || !key.trim()) {
    return 'missing';
  }
  if (isPlaceholderString(key)) {
    return 'placeholder';
  }
  const buf = decodeKeyToBuffer(key);
  if (!buf || buf.length !== 32) {
    return 'malformed';
  }
  return 'valid-looking';
}

/**
 * Generate a random short ID (hex string, default 8 bytes = 16 hex chars).
 */
export function generateShortId(bytes = 8): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Validate a REALITY short ID.
 * Must be an even-length hex string between 0 and 16 characters (0 to 8 bytes).
 */
export function validateShortId(shortId: string | undefined | null): { valid: boolean; error?: string } {
  if (shortId === undefined || shortId === null || shortId === '') {
    // Empty shortId is technically allowed in Xray for no shortId, but in client/server pairing must match
    return { valid: true };
  }
  if (typeof shortId !== 'string') {
    return { valid: false, error: 'Short ID must be a string' };
  }
  const trimmed = shortId.trim();
  if (isPlaceholderString(trimmed)) {
    return { valid: false, error: 'Short ID is a placeholder value' };
  }
  if (!/^[0-9a-fA-F]*$/.test(trimmed)) {
    return { valid: false, error: 'Short ID must contain only hexadecimal characters' };
  }
  if (trimmed.length % 2 !== 0) {
    return { valid: false, error: `Short ID length (${trimmed.length}) must be even (full byte representation)` };
  }
  if (trimmed.length > 16) {
    return { valid: false, error: `Short ID length (${trimmed.length}) exceeds maximum 16 hex characters (8 bytes)` };
  }
  return { valid: true };
}
