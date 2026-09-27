// Security-review finding: no file-size limit existed on this upload/parse
// endpoint before this test's subject change (app/api/import/route.ts).

import { POST } from './route';

function makeFileRequest(file: File): Request {
    const formData = new FormData();
    formData.append('file', file);
    return new Request('http://localhost:3888/api/import', { method: 'POST', body: formData });
}

describe('POST /api/import', () => {
    it('rejects a file larger than the configured max with 413', async () => {
        const oversized = new File([new Uint8Array(21 * 1024 * 1024)], 'huge.gpx', { type: 'application/gpx+xml' });
        const res = await POST(makeFileRequest(oversized));
        expect(res.status).toBe(413);
        const body = await res.json();
        expect(body.error).toMatch(/too large/i);
    });

    it('accepts a file at exactly the size limit and proceeds to type/content checks', async () => {
        // Exactly at the limit -- shouldn't be rejected for size; it's still an
        // unsupported extension, so it should reach the 400 (not 413) branch.
        const atLimit = new File([new Uint8Array(20 * 1024 * 1024)], 'atlimit.xyz');
        const res = await POST(makeFileRequest(atLimit));
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/unsupported file type/i);
    });

    it('returns 400 when no file is provided', async () => {
        const res = await POST(new Request('http://localhost:3888/api/import', { method: 'POST', body: new FormData() }));
        expect(res.status).toBe(400);
    });

    it('returns 400 for an unsupported file extension', async () => {
        const file = new File(['not a route'], 'notes.txt', { type: 'text/plain' });
        const res = await POST(makeFileRequest(file));
        expect(res.status).toBe(400);
    });
});
