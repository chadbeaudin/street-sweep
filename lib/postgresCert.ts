import net from 'net';
import tls from 'tls';

const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
const TIMEOUT_MS = 4000;

// Postgres negotiates TLS in-band, so tls.connect alone can't reach its cert (#155).
// Verification is off because a failing cert still has to be read; no credentials are sent.
export async function readPostgresCertExpiry(databaseUrl: string): Promise<Date | null> {
    const { hostname, port } = new URL(databaseUrl);
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: hostname, port: Number(port) || 5432 });
        socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('timed out')));
        socket.once('error', reject);
        socket.once('connect', () => socket.write(SSL_REQUEST));
        socket.once('data', reply => {
            if (reply.toString() !== 'S') {
                socket.destroy();
                resolve(null);
                return;
            }
            const secure = tls.connect({ socket, servername: hostname, rejectUnauthorized: false }, () => {
                const expiry = new Date(secure.getPeerCertificate().valid_to);
                secure.destroy();
                resolve(expiry);
            });
            secure.once('error', reject);
        });
    });
}
