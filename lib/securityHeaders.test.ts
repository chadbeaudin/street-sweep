import { securityHeaders } from './securityHeaders';

function header(isDev: boolean, key: string): string | undefined {
    return securityHeaders(isDev).find((h: { key: string }) => h.key === key)?.value;
}

describe('securityHeaders (#194)', () => {
    it('sets the baseline hardening headers', () => {
        expect(header(false, 'X-Frame-Options')).toBe('DENY');
        expect(header(false, 'X-Content-Type-Options')).toBe('nosniff');
        expect(header(false, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(header(false, 'Strict-Transport-Security')).toMatch(/max-age=\d+/);
    });

    it('locks down framing, plugins and base URI in the CSP', () => {
        const csp = header(false, 'Content-Security-Policy')!;
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("connect-src 'self'");
    });

    it('allows eval and websockets only in dev', () => {
        expect(header(false, 'Content-Security-Policy')).not.toContain('unsafe-eval');
        expect(header(false, 'Content-Security-Policy')).not.toContain('ws:');
        expect(header(true, 'Content-Security-Policy')).toContain("'unsafe-eval'");
        expect(header(true, 'Content-Security-Policy')).toContain('ws:');
    });
});
