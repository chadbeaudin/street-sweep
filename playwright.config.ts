import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_ENV, E2E_PORT, E2E_MAP_CENTER } from './e2e/env';

export default defineConfig({
    testDir: './e2e',
    timeout: 120_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    globalSetup: './e2e/global-setup.ts',
    use: {
        baseURL: E2E_BASE_URL,
        geolocation: E2E_MAP_CENTER,
        permissions: ['geolocation'],
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: [
        {
            command: 'node e2e/stub-server.mjs',
            port: Number(E2E_ENV.E2E_STUB_PORT),
            env: E2E_ENV,
            reuseExistingServer: !process.env.CI,
        },
        {
            command: `npx next build && npx next start -p ${E2E_PORT}`,
            url: E2E_BASE_URL,
            env: E2E_ENV,
            timeout: 600_000,
            stdout: 'pipe',
            reuseExistingServer: !process.env.CI,
        },
    ],
});
