import fs from 'fs';
import path from 'path';

// Next.js caches rendered pages under <distDir>/server/route-cache at runtime. On Fly
// that folder outlives a deploy, so a new build served the old build's home page,
// whose script files no longer existed, and the app never loaded (#218). Cleared
// at startup so every build serves its own pages.
export function clearRouteCache(distDir = process.env.NEXT_DIST_DIR || '.next'): boolean {
    const dir = path.join(process.cwd(), distDir, 'server', 'route-cache');
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
}
