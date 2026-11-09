// The integration suite runs its own `next dev`; it must never build into the
// `.next` a developer's server is using (#187).
import fs from 'fs';

describe('integration server isolation (#187)', () => {
    const nextConfig = fs.readFileSync('next.config.mjs', 'utf8');
    const integration = fs.readFileSync('tests/integration/server.test.ts', 'utf8');

    it('lets the build directory be overridden, defaulting to .next', () => {
        expect(nextConfig).toMatch(/distDir: process\.env\.NEXT_DIST_DIR \|\| '\.next'/);
    });

    it('starts the integration server with its own build directory', () => {
        expect(integration).toMatch(/const INTEGRATION_DIST_DIR = '\.next-integration'/);
        expect(integration).toMatch(/NEXT_DIST_DIR: INTEGRATION_DIST_DIR/);
    });

    it('keeps that directory out of git, and its generated types in the type check', () => {
        expect(fs.readFileSync('.gitignore', 'utf8')).toContain('/.next-integration/');
        expect(JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')).include).toContain('.next-integration/types/**/*.ts');
    });
});
