import crypto from 'crypto';

// Encrypts OAuth access/refresh tokens before they hit Postgres (Account.
// access_token/refresh_token were stored in plaintext -- a DB compromise
// meant every linked user's Strava tokens were compromised too). AES-256-GCM
// with a random IV per value and an auth tag, so ciphertext can't be
// tampered with undetected. Key comes from ACCOUNT_TOKEN_ENCRYPTION_KEY (32
// random bytes, base64) -- never the DB, so a DB-only compromise doesn't
// also hand over the decryption key.
const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function getKey(): Buffer {
    const b64 = process.env.ACCOUNT_TOKEN_ENCRYPTION_KEY;
    if (!b64) throw new Error('ACCOUNT_TOKEN_ENCRYPTION_KEY is not set');
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) throw new Error('ACCOUNT_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
    return key;
}

export function encryptToken(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

// Tolerates plaintext values written before this encryption was added
// (existing test-only Account rows from this session) -- anything not
// matching the versioned ciphertext shape is returned as-is rather than
// throwing, so old rows keep working until they're naturally re-linked.
export function decryptToken(value: string): string {
    const parts = value.split(':');
    if (parts.length !== 4 || parts[0] !== VERSION) return value;

    const [, ivB64, tagB64, dataB64] = parts;
    try {
        const iv = Buffer.from(ivB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const data = Buffer.from(dataB64, 'base64');
        const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
        return decrypted.toString('utf8');
    } catch {
        // Malformed/tampered ciphertext, or wrong key -- never silently
        // return partial garbage as a "valid" token.
        throw new Error('Failed to decrypt token');
    }
}
