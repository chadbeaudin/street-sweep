import { promises as fs } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import type { OverpassResponse } from './types';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const CACHE_DIR = process.env.OSM_CACHE_DIR || path.join(process.cwd(), '.cache', 'osm');
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days — OSM streets don't change meaningfully month to month

let dirEnsured: Promise<void> | null = null;
function ensureDir(): Promise<void> {
    if (!dirEnsured) dirEnsured = fs.mkdir(CACHE_DIR, { recursive: true }).then(() => undefined);
    return dirEnsured;
}

function fileFor(key: string): string {
    // Cache keys (e.g. "v4_47.6150,-117.4850,47.6700,-117.3300") are filesystem-safe
    // but the commas are noisy — swap for underscores so listings stay readable.
    return path.join(CACHE_DIR, key.replace(/[,]/g, '_') + '.json.gz');
}

export async function readDiskCache(key: string): Promise<OverpassResponse | null> {
    try {
        await ensureDir();
        const file = fileFor(key);
        const stat = await fs.stat(file).catch(() => null);
        if (!stat) return null;
        if (Date.now() - stat.mtimeMs > TTL_MS) {
            await fs.unlink(file).catch(() => {});
            return null;
        }
        const gzipped = await fs.readFile(file);
        const json = (await gunzip(gzipped)).toString('utf8');
        return JSON.parse(json) as OverpassResponse;
    } catch (e: any) {
        // Corrupt file, IO error, etc. — treat as miss; the caller will refill.
        console.warn(`[osmDiskCache] read failed for ${key}: ${e?.message || e}`);
        return null;
    }
}

export async function writeDiskCache(key: string, data: OverpassResponse): Promise<void> {
    try {
        await ensureDir();
        const file = fileFor(key);
        const tmp = file + '.tmp';
        const gzipped = await gzip(Buffer.from(JSON.stringify(data), 'utf8'));
        // Atomic write so a concurrent reader never sees a partial file.
        await fs.writeFile(tmp, gzipped);
        await fs.rename(tmp, file);
    } catch (e: any) {
        console.warn(`[osmDiskCache] write failed for ${key}: ${e?.message || e}`);
    }
}

export function getCacheDir(): string {
    return CACHE_DIR;
}
