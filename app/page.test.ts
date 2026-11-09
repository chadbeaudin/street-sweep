// app/page.tsx is one large client component with no render tests; these pin
// down wiring that unit tests of its helpers can't see.
import fs from 'fs';

const page = fs.readFileSync('app/page.tsx', 'utf8');

describe('page code splitting (#182)', () => {
    const staticImports = page.split('\n').filter(l => /^import /.test(l));

    it('keeps the chart components out of the page bundle', () => {
        for (const component of ['StatsDialog', 'ElevationProfile']) {
            expect(staticImports.some(l => l.includes(`@/components/${component}'`))).toBe(false);
            expect(page).toContain(`import('@/components/${component}')`);
        }
        expect(staticImports.some(l => l.includes("'recharts'"))).toBe(false);
    });

    it('renders each chart component only when it is shown, so nothing downloads it early', () => {
        expect(page).toMatch(/\{\(chartsPreloaded \|\| showStats\) && \(\s*<StatsDialog/);
        expect(page).toMatch(/\{elevationData && \(\s*<ElevationProfile/);
    });

    it('preloads both after the page loads', () => {
        expect(page).toMatch(/preloadAfter\(CHART_PRELOAD_DELAY_MS, \[loadStatsDialog, loadElevationProfile\], \(\) => setChartsPreloaded\(true\)\)/);
    });
});

describe('ridden-roads matching notice (#183)', () => {
    it('only shows once matching has run for a few seconds', () => {
        expect(page).toMatch(/useDelayedFlag\(isRiddenComputing, RIDDEN_MATCHING_NOTICE_DELAY_MS\)/);
        expect(page).toMatch(/\{showRiddenMatchingNotice && !isStravaLoading && \(/);
        expect(page).not.toMatch(/\{isRiddenComputing && !isStravaLoading && \(/);
    });
});

describe('road payload encoding (#181)', () => {
    it('asks /api/roads for encoded roads and decodes them', () => {
        expect(page).toContain("body: JSON.stringify({ bbox: fetchBbox, encoding: ROAD_ENCODING })");
        expect(page).toMatch(/data\.encoding === ROAD_ENCODING \? decodeRoads\(data\.roads\) : data\.roads/);
    });
});
