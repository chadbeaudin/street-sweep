import securityHeadersModule from './lib/securityHeaders.js';

const { securityHeaders } = securityHeadersModule;

/** @type {import('next').NextConfig} */
const nextConfig = {
    // The integration tests run their own dev server; a separate build directory
    // keeps it from overwriting the one a developer's server is using (#187).
    distDir: process.env.NEXT_DIST_DIR || '.next',
    output: 'standalone',
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders(process.env.NODE_ENV !== 'production') }];
    },
};

export default nextConfig;
