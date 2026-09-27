const TEST_KEY = 'VxSApn5lkxSrTPwW3knxm+qzedvupdNe9giTEBPFaTM=';

describe('tokenCrypto', () => {
    const originalEnv = process.env.ACCOUNT_TOKEN_ENCRYPTION_KEY;

    beforeEach(() => {
        process.env.ACCOUNT_TOKEN_ENCRYPTION_KEY = TEST_KEY;
        jest.resetModules();
    });

    afterAll(() => {
        process.env.ACCOUNT_TOKEN_ENCRYPTION_KEY = originalEnv;
    });

    it('round-trips a token through encrypt/decrypt', () => {
        const { encryptToken, decryptToken } = require('./tokenCrypto');
        const plain = 'a-real-strava-refresh-token-12345';
        const cipher = encryptToken(plain);
        expect(cipher).not.toBe(plain);
        expect(decryptToken(cipher)).toBe(plain);
    });

    it('produces different ciphertext for the same plaintext each time (random IV)', () => {
        const { encryptToken } = require('./tokenCrypto');
        const a = encryptToken('same-value');
        const b = encryptToken('same-value');
        expect(a).not.toBe(b);
    });

    it('passes through a legacy plaintext value unchanged (pre-encryption rows)', () => {
        const { decryptToken } = require('./tokenCrypto');
        expect(decryptToken('plain-old-refresh-token')).toBe('plain-old-refresh-token');
    });

    it('throws on tampered ciphertext rather than returning garbage', () => {
        const { encryptToken, decryptToken } = require('./tokenCrypto');
        const cipher: string = encryptToken('secret-value');
        const parts = cipher.split(':');
        // Flip the last character of the ciphertext payload to corrupt it.
        parts[3] = parts[3].slice(0, -1) + (parts[3].slice(-1) === 'A' ? 'B' : 'A');
        expect(() => decryptToken(parts.join(':'))).toThrow();
    });

    it('throws when the encryption key is missing', () => {
        delete process.env.ACCOUNT_TOKEN_ENCRYPTION_KEY;
        const { encryptToken } = require('./tokenCrypto');
        expect(() => encryptToken('x')).toThrow('ACCOUNT_TOKEN_ENCRYPTION_KEY is not set');
    });

    it('throws when the key is not exactly 32 bytes', () => {
        process.env.ACCOUNT_TOKEN_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
        const { encryptToken } = require('./tokenCrypto');
        expect(() => encryptToken('x')).toThrow('32 bytes');
    });
});
