import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearRouteCache } from './routeCache';

describe('clearRouteCache (#218)', () => {
    let root: string;
    const cwd = process.cwd();

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-cache-'));
        process.chdir(root);
    });
    afterEach(() => {
        process.chdir(cwd);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("removes a previous build's cached pages and keeps the current build's own", () => {
        const cached = path.join(root, '.next', 'server', 'route-cache', 'APP_PAGE', 'abc', '$');
        fs.mkdirSync(cached, { recursive: true });
        fs.writeFileSync(path.join(cached, 'index.html'), 'old build');
        const built = path.join(root, '.next', 'server', 'app');
        fs.mkdirSync(built, { recursive: true });
        fs.writeFileSync(path.join(built, 'index.html'), 'this build');

        expect(clearRouteCache()).toBe(true);
        expect(fs.existsSync(path.join(root, '.next', 'server', 'route-cache'))).toBe(false);
        expect(fs.readFileSync(path.join(built, 'index.html'), 'utf8')).toBe('this build');
    });

    it('does nothing when there is no cache, and honours a custom build directory', () => {
        expect(clearRouteCache()).toBe(false);
        fs.mkdirSync(path.join(root, '.next-integration', 'server', 'route-cache'), { recursive: true });
        expect(clearRouteCache('.next-integration')).toBe(true);
        expect(fs.existsSync(path.join(root, '.next-integration', 'server', 'route-cache'))).toBe(false);
    });
});
