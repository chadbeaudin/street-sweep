/** @type {import('next').NextConfig} */
const nextConfig = {
    // The integration tests run their own dev server; a separate build directory
    // keeps it from overwriting the one a developer's server is using (#187).
    distDir: process.env.NEXT_DIST_DIR || '.next',
    output: 'standalone',
    experimental: {
        instrumentationHook: true,
    },
};

export default nextConfig;
