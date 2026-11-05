import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakePostgres, generateCert, startFakePostgres } from '../tests/helpers/fakePostgresTls';

const DOMAIN = 'postgres.example.test';
const SCRIPT = path.join(__dirname, 'sync-postgres-cert.sh');

describe('sync-postgres-cert.sh (#155)', () => {
    let root: string;
    let npmDir: string;
    let pgDir: string;
    let dockerLog: string;
    let server: FakePostgres;
    let served: { cert: Buffer; key: Buffer };

    const read = (dir: string) => ({
        cert: fs.readFileSync(path.join(dir, 'fullchain.pem')),
        key: fs.readFileSync(path.join(dir, 'privkey.pem')),
    });

    // Stands in for docker: logs the call and, unless told otherwise, reloads like a SIGHUP would.
    const writeDocker = (reloads: boolean) => {
        const bin = path.join(root, 'bin');
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\necho "$@" >> "${dockerLog}"\n${reloads ? `touch "${root}/reloaded"\n` : ''}`, { mode: 0o755 });
    };

    const run = () => new Promise<{ code: number; output: string }>(resolve => {
        execFile('bash', [SCRIPT], {
            env: {
                ...process.env,
                PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
                NPM_CERT_DIR: npmDir,
                PG_CERT_DIR: pgDir,
                PG_CONTAINER: 'pg',
                PG_ADDRESS: `127.0.0.1:${server.port}`,
                CERT_DOMAIN: DOMAIN,
            },
        }, (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, output: stdout + stderr }));
    });

    const dockerCalls = () => fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8').trim() : '';

    beforeEach(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-sync-'));
        npmDir = path.join(root, 'npm');
        pgDir = path.join(root, 'pg');
        dockerLog = path.join(root, 'docker.log');
        fs.mkdirSync(npmDir);
        fs.mkdirSync(pgDir);
        generateCert(npmDir, DOMAIN, 90);
        generateCert(pgDir, DOMAIN, 1);
        fs.chmodSync(path.join(pgDir, 'privkey.pem'), 0o600);
        served = read(pgDir);
        writeDocker(true);
        server = await startFakePostgres(() => {
            if (fs.existsSync(path.join(root, 'reloaded'))) served = read(pgDir);
            return served;
        });
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('does nothing when Postgres already serves the renewed cert', async () => {
        served = read(npmDir);
        const before = read(pgDir);
        const { code, output } = await run();
        expect(code).toBe(0);
        expect(output).toContain('already serves');
        expect(dockerCalls()).toBe('');
        expect(read(pgDir)).toEqual(before);
    });

    it('copies a renewed cert and reloads Postgres without a restart', async () => {
        const { code, output } = await run();
        expect(code).toBe(0);
        expect(output).toContain('now serves');
        expect(dockerCalls()).toBe('kill --signal=HUP pg');
        expect(read(pgDir)).toEqual(read(npmDir));
        expect(fs.statSync(path.join(pgDir, 'privkey.pem')).mode & 0o777).toBe(0o600);
    });

    it('refuses a cert for another domain and leaves Postgres alone', async () => {
        generateCert(npmDir, 'other.example.test', 90);
        const before = read(pgDir);
        const { code, output } = await run();
        expect(code).toBe(1);
        expect(output).toContain('Refusing to sync');
        expect(dockerCalls()).toBe('');
        expect(read(pgDir)).toEqual(before);
    });

    it('fails when Postgres keeps serving the old cert after the reload', async () => {
        writeDocker(false);
        const { code, output } = await run();
        expect(code).toBe(1);
        expect(output).toContain('not serving the renewed certificate');
    });
});
