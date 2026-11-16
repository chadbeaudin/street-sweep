// components/Map.tsx needs a real browser (Leaflet), so this pins down the marker wiring.
import fs from 'fs';

const map = fs.readFileSync('components/Map.tsx', 'utf8');

describe('loop start and finish marker (#236)', () => {
    it('draws one half-green, half-red marker for a loop instead of hiding the start under the finish', () => {
        expect(map).toContain("const isLoopEnd = loopTwinIndex(selectedPoints, idx) !== null;");
        expect(map).toContain('if (isLoopEnd && idx === 0) return null;');
        expect(map).toMatch(/const START_FINISH_FILL = 'linear-gradient\(90deg, #10B981 50%, #EF4444 50%\)'/);
        expect(map).toContain("'Start and finish: drag to move both, right-click to delete'");
    });
});
