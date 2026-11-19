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
        expect(page).toMatch(/\{showRiddenMatchingNotice && !isStravaLoading && !isSuggesting && \(/);
        expect(page).not.toMatch(/\{isRiddenComputing && !isStravaLoading && \(/);
    });
});

describe('suggest a route preference note (#227)', () => {
    it('shows the note a hampered suggestion comes back with, and lets the rider dismiss it', () => {
        expect(page).toContain('setSuggestNote(data.note ?? null)');
        expect(page).toMatch(/\{suggestNote && \(/);
        // A floating card over the map, not a bar across the whole screen.
        expect(page).toMatch(/\{suggestNote && \(\s+<div className="absolute top-20 left-1\/2[^"]*w-\[min\(28rem/);
        expect(page).toContain('onClick={() => setSuggestNote(null)}');
    });
});

describe('moving a suggestion start (#236)', () => {
    it('plans a new suggestion from where the start/finish of a suggested loop is dropped', () => {
        const handler = page.slice(page.indexOf('const handlePointMove = useCallback'), page.indexOf('const handlePointMoveStart'));
        expect(handler).toMatch(/if \(twinIdx !== null && suggestionActiveRef\.current\) \{\s+suggestRouteRef\.current\(newLatLng\);\s+return;/);
        expect(page).toContain('suggestionActiveRef.current = true;');
        expect(page).toContain('useEffect(() => { suggestRouteRef.current = handleSuggestRoute; }, [handleSuggestRoute]);');
    });

    it('treats the route as ordinary once it is edited any other way', () => {
        for (const handler of ['const addPoint = useCallback', 'const handlePointDelete = useCallback', 'const clearPoints = useCallback']) {
            const body = page.slice(page.indexOf(handler), page.indexOf(handler) + 400);
            expect(body).toContain('suggestionActiveRef.current = false;');
        }
        expect(page).toMatch(/if \(selectionBoxes\.length > 0 \|\| selectionPolygons\.length > 0\) suggestionActiveRef\.current = false;/);
    });
});

describe('moving a loop start (#236)', () => {
    it("moves a loop's start and end together, re-routing the legs at both ends", () => {
        const handler = page.slice(page.indexOf('const handlePointMove = useCallback'), page.indexOf('const handlePointMoveStart'));
        expect(handler).toContain('loopTwinIndex(pointsRef.current, idx)');
        expect(handler).toContain('getAffectedSegmentIndices(twinIdx, pointsRef.current.length)');
        expect(handler).toMatch(/applyMovedPoint\(movedPoints, twinId/);
    });
});

describe('suggest a route placement (#224)', () => {
    it('places the planned legs directly instead of routing each waypoint again', () => {
        const handler = page.slice(page.indexOf('const handleSuggestRoute = useCallback'), page.indexOf('// A new area supersedes'));
        expect(handler).toContain('placeSuggestedRoute(data.waypoints, data.legs)');
        expect(handler).toContain('manualRouteRef.current = legs');
        expect(handler).not.toMatch(/addPoint\(/);
        expect(handler).not.toContain('/api/step');
    });
});

describe('suggest a route progress (#80)', () => {
    it('marks the picked start and shows a progress pill while the suggestion is planned', () => {
        expect(page).toMatch(/setSuggestStart\(start\);\s+setIsSuggesting\(true\)/);
        expect(page).toContain('suggestStart={suggestStart}');
        expect(page).toMatch(/\{isSuggesting && \(\s+<div[^>]*>\s+<Loader2/);
    });

    it('names what it is doing, and leaves the result to the route preview', () => {
        expect(page).toContain("{suggestTarget ? suggestTargetMessage(suggestTarget, units) : 'Finding your typical ride'}&hellip;");
        expect(page).toContain("fetch('/api/suggest/target'");
        expect(page).not.toMatch(/setSuggestion\(/);
    });
});

describe('road payload encoding (#181)', () => {
    it('asks /api/roads for encoded roads and decodes them', () => {
        expect(page).toContain("body: JSON.stringify({ bbox: fetchBbox, encoding: ROAD_ENCODING })");
        expect(page).toMatch(/data\.encoding === ROAD_ENCODING \? decodeRoads\(data\.roads\) : data\.roads/);
    });
});

describe('preferred roads (#46)', () => {
    it("marks roads with the same draft as Avoid and saves them to the account's preferred list", () => {
        expect(page).toContain("const list = prev === 'avoid' ? 'avoidedRoads' : 'preferredRoads';");
        expect(page).toContain("useMarkedRoadsSync('/api/preferred-roads', sessionStatus, routingOptions.preferredRoads, setPreferredRoads);");
        expect(page).toContain("toggleMarkMode('prefer')");
    });
});

describe('optimize an imported route (#35)', () => {
    it('asks for a detour tolerance before regenerating an imported route', () => {
        expect(page).toContain("onClick={() => isImportedRouteRef.current ? setShowDetourDialog(true) : handleGenerate()}");
        expect(page).toContain("handleGenerate(false, m)");
    });

    it('sends the imported track and tolerance, and keeps the original as an overlay', () => {
        expect(page).toContain("importedRoute: importedTrack,");
        expect(page).toContain("detourToleranceM: importedTrack ? detourM : undefined,");
        expect(page).toContain("if (importedTrack) setImportedOverlay(importedTrack);");
        expect(page).toContain("importedOverlay={importedOverlay}");
    });
});

describe('header and mode toolbar consistency (#249)', () => {
    it('says Generate until a route exists, and is disabled with nothing to route', () => {
        expect(page).toContain("const generateLabel = route ? 'Regenerate Route' : 'Generate Route';");
        expect(page).not.toContain("'Regenerate Route'\n");
        expect(page.match(/disabled=\{loading \|\| !hasWork\}/g)).toHaveLength(2);
    });

    it('uses one name for the reset button', () => {
        expect(page).not.toContain('Clear Workspace');
        expect(page).toContain('disabled={!hasWork}');
    });

    it('offers Suggest only before any work starts', () => {
        expect(page).toContain('const canSuggest = hasStravaCreds(stravaCredentials) && !hasWork;');
    });

    it('puts the buttons that come and go after the fixed ones in the header', () => {
        const left = page.slice(page.indexOf('Fixed buttons sit right after the logo'), page.indexOf('hidden md:flex items-center gap-2 min-[1440px]:gap-3">'));
        const order = ['RwgpsHeaderButton', 'title="Import a GPX', 'title="Preferences"', 'title="View coverage stats"', 'title="Browse your RideWithGPS library"', '{canSuggest && (', 'title="Clear imported route"'];
        const positions = order.map(marker => left.indexOf(marker));
        expect(positions.every(p => p >= 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);

        const right = page.slice(page.indexOf('hidden md:flex items-center gap-2 min-[1440px]:gap-3">'));
        expect(right.indexOf('{route && (')).toBeLessThan(right.indexOf('onClick={handleUndo}'));
    });

    it('fits the header at 1280px by dropping secondary labels below 1440px', () => {
        expect(page).toContain('<span className="hidden min-[1440px]:inline">Import</span>');
        expect(page).toContain('<span className="hidden min-[1440px]:inline">Stats</span>');
        expect(page).toContain('Below 1440px the full export row');
        expect(page.split('className="hidden min-[1440px]:flex items-center')).toHaveLength(4);
    });

    it('pins the mode selector by putting its extra buttons to its left on desktop', () => {
        expect(page).toContain('md:absolute md:right-full md:top-0 md:mr-1');
    });

    it('says when drawing an area or lasso drops back to Point mode', () => {
        expect(page).toContain("showModeHint('Area added — back to Point mode');");
        expect(page).toContain("showModeHint('Lasso added — back to Point mode');");
    });

    it('names the settings dialog after what it holds and uses switches for the avoid options', () => {
        expect(page).toContain('title="Preferences"');
        expect(page).toContain('>Preferences</h2>');
        expect(page).not.toContain('Routing Preferences');
        expect(page).toContain('<SwitchRow label="Avoid Gravel"');
        expect(page).toContain('New Road Preference: {routingOptions.riddenPenalty}x');
    });
});
