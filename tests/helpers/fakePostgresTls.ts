import { execFileSync } from 'child_process';
import net, { AddressInfo } from 'net';
import path from 'path';
import tls from 'tls';

export function generateCert(dir: string, domain: string, days: number): void {
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
        '-keyout', path.join(dir, 'privkey.pem'), '-out', path.join(dir, 'fullchain.pem'),
        '-days', String(days), '-subj', `/CN=${domain}`, '-addext', `subjectAltName=DNS:${domain}`,
    ], { stdio: 'ignore' });
}

export interface FakePostgres {
    port: number;
    close: () => Promise<void>;
}

// Answers the SSLRequest like Postgres does. loadCert returning null means TLS is off.
export async function startFakePostgres(loadCert: () => tls.SecureContextOptions | null): Promise<FakePostgres> {
    const sockets = new Set<net.Socket>();
    const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.once('data', () => {
            const cert = loadCert();
            socket.write(cert ? 'S' : 'N');
            if (!cert) return;
            new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext(cert) }).on('error', () => {});
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        port: (server.address() as AddressInfo).port,
        close: () => new Promise(resolve => {
            sockets.forEach(s => s.destroy());
            server.close(() => resolve());
        }),
    };
}
