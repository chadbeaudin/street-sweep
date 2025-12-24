import { StreetGraph } from './graph';

describe('StreetGraph Snapping Accuracy', () => {
    let graph: StreetGraph;

    beforeEach(() => {
        graph = new StreetGraph();
        // Add a diagonal road segment at 45 degrees latitude
        // cos(45) = 1/sqrt(2) approx 0.707
        const lat1 = 45.0000;
        const lon1 = -73.0000;
        const lat2 = 45.0001; // +11.1m
        const lon2 = -72.9999; // +11.1m * 0.707 = 7.85m

        graph.graph.addNode('1', { lat: lat1, lon: lon1, degree: 1 });
        graph.graph.addNode('2', { lat: lat2, lon: lon2, degree: 1 });
        graph.graph.addLink('1', '2', { weight: 15, id: 'way1' });
    });

    test('snapping accounts for lat/lon aspect ratio', () => {
        const lat1 = 45.0000;
        const lon1 = -73.0000;
        const lat2 = 45.0001;
        const lon2 = -72.9999;

        // Click point that is equidistant in degrees to both nodes
        // (45.0001, -73.0000) is "above" the first node and "left" of the second.
        // In degrees:
        // dist to Node 1: dLat=0.0001, dLon=0.0 -> dist=0.0001
        // dist to Node 2: dLat=0.0, dLon=0.0001 -> dist=0.0001
        // In old logic, it would snap to the midpoint (t=0.5).

        // In NEW logic:
        // dLat = 0.0001
        // dLonScaled = 0.0001 * cos(45) = 0.0000707
        // relLat = 45.0001 - 45.0000 = 0.0001
        // relLonScaled = (-73.0000 - (-73.0000)) * cos(45) = 0
        // t = (relLat * dLat + 0) / (dLat^2 + dLonScaled^2)
        // t = (0.0001 * 0.0001) / (0.0001^2 + 0.0000707^2)
        // t = 1e-8 / (1e-8 + 0.5e-8) = 1 / 1.5 = 0.666...

        const snapped = graph.findClosestPointOnEdge(45.0001, -73.0000);
        expect(snapped).not.toBeNull();
        if (snapped) {
            // t should be > 0.5 because latitude difference (which is larger in meters per degree) 
            // should pull the projection further along the segment.
            const t = (snapped.lat - lat1) / (lat2 - lat1);
            expect(t).toBeGreaterThan(0.6);
            expect(t).toBeLessThan(0.7);
        }
    });

    test('node selection restricted to snapped edge (prevents road jumping)', () => {
        // Road A: (0,0) to (1,1)
        graph = new StreetGraph();
        graph.graph.addNode('A1', { lat: 0, lon: 0, degree: 1 });
        graph.graph.addNode('A2', { lat: 1, lon: 1, degree: 1 });
        graph.graph.addLink('A1', 'A2', { weight: 157000, id: 'roadA' });

        // Road B: (0.5, 0.4) to (0.5, 0.6) - very short road passing near center of Road A
        graph.graph.addNode('B1', { lat: 0.5, lon: 0.4, degree: 1 });
        graph.graph.addNode('B2', { lat: 0.5, lon: 0.6, degree: 1 });
        graph.graph.addLink('B1', 'B2', { weight: 10, id: 'roadB' });

        // Click on Road A at (0.5, 0.5)
        const clickLat = 0.5;
        const clickLon = 0.5;

        // Snapping should find Road A
        const snapped = graph.findClosestPointOnEdge(clickLat, clickLon);
        expect(snapped).not.toBeNull();
        expect(snapped?.u === 'A1' || snapped?.u === 'A2').toBe(true);

        // findClosestNode WITHOUT restriction would find B1 or B2 (distance ~0.1 or 0 in flat)
        // distance to A1: sqrt(0.5^2 + 0.5^2) = 0.707
        // distance to B1: 0.1
        const closestAny = graph.findClosestNode(clickLat, clickLon);
        expect(closestAny).toMatch(/^B/);

        // findClosestNode WITH restriction to A1, A2 should find A1 or A2
        const closestRestricted = graph.findClosestNode(clickLat, clickLon, new Set(['A1', 'A2']));
        expect(closestRestricted).toMatch(/^A/);
    });
});
