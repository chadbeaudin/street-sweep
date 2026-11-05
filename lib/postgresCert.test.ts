import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakePostgres, generateCert, startFakePostgres } from '../tests/helpers/fakePostgresTls';
import { readPostgresCertExpiry } from './postgresCert';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('readPostgresCertExpiry (#155)', () => {
    let dir: string;
    let server: FakePostgres;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-cert-'));
        generateCert(dir, 'postgres.example.test', 30);
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reads the expiry through the Postgres TLS handshake', async () => {
        server = await startFakePostgres(() => ({
            cert: fs.readFileSync(path.join(dir, 'fullchain.pem')),
            key: fs.readFileSync(path.join(dir, 'privkey.pem')),
        }));
        const expiry = await readPostgresCertExpiry(`postgresql://user:pw@localhost:${server.port}/db`);
        expect(Math.round((expiry!.getTime() - Date.now()) / DAY_MS)).toBe(30);
    });

    it('returns null when the server has TLS off', async () => {
        server = await startFakePostgres(() => null);
        expect(await readPostgresCertExpiry(`postgresql://user:pw@localhost:${server.port}/db`)).toBeNull();
    });

    it('rejects when nothing is listening', async () => {
        server = await startFakePostgres(() => null);
        const { port } = server;
        await server.close();
        await expect(readPostgresCertExpiry(`postgresql://user:pw@127.0.0.1:${port}/db`)).rejects.toThrow();
    });
});
