// Stands in for Overpass (OVERPASS_URL) and Open Topo Data (OPEN_TOPO_URL) so the
// e2e run never touches the network: every street query gets the fixture area.
import http from 'http';
import fs from 'fs';

const PORT = Number(process.env.E2E_STUB_PORT || 3898);
const osm = fs.readFileSync(new URL('./fixtures/osm.json', import.meta.url));

http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/api/interpreter') {
        req.resume();
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(osm);
        });
        return;
    }
    if (url.pathname.startsWith('/v1/')) {
        const count = (url.searchParams.get('locations') || '').split('|').filter(Boolean).length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: Array.from({ length: count }, () => ({ elevation: 600 })) }));
        return;
    }
    res.writeHead(url.pathname === '/api/status' ? 200 : 404);
    res.end();
}).listen(PORT, () => console.log(`e2e stub listening on ${PORT}`));
