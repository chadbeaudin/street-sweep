import { configuredBaseUrl } from './baseUrl';

const ORIGINAL_ENV = process.env;
afterEach(() => { process.env = ORIGINAL_ENV; });

describe('configuredBaseUrl (#195)', () => {
    it('prefers NEXTAUTH_URL and strips a trailing slash', () => {
        process.env = { ...ORIGINAL_ENV, NEXTAUTH_URL: 'https://a.test/', NEXT_PUBLIC_BASE_URL: 'https://b.test' };
        expect(configuredBaseUrl()).toBe('https://a.test');
    });

    it('falls back to NEXT_PUBLIC_BASE_URL', () => {
        process.env = { ...ORIGINAL_ENV, NEXTAUTH_URL: '', NEXT_PUBLIC_BASE_URL: 'https://b.test' };
        expect(configuredBaseUrl()).toBe('https://b.test');
    });

    it('throws when neither is set', () => {
        process.env = { ...ORIGINAL_ENV, NEXTAUTH_URL: '', NEXT_PUBLIC_BASE_URL: '' };
        expect(() => configuredBaseUrl()).toThrow();
    });
});
