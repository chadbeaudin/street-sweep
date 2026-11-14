// CommonJS so next.config.mjs can import it at build time (#194).
// Next's App Router injects inline bootstrap scripts without a nonce, so
// script-src needs 'unsafe-inline' (that also covers the theme script in
// app/layout.tsx); Leaflet sets inline styles. Dev additionally needs eval for HMR.
function contentSecurityPolicy(isDev) {
    return [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
        "style-src 'self' 'unsafe-inline'",
        // Map tiles (lib/mapStyles.ts), Leaflet marker icons and Strava avatars.
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        `connect-src 'self'${isDev ? ' ws:' : ''}`,
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self' https://www.strava.com",
        "frame-ancestors 'none'",
    ].join('; ');
}

function securityHeaders(isDev) {
    return [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy(isDev) },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    ];
}

module.exports = { securityHeaders };
