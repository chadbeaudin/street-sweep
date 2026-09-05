'use client';

import { ErrorDialog } from '@/components/ErrorDialog';
import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Undo2, Redo2, Settings2, Check, ChevronDown, Eraser, Settings, BarChart3, Home as HomeIcon, X, Menu, MoreVertical } from 'lucide-react';
import { StravaSettingsDialog } from '@/components/StravaSettingsDialog';
import { StravaHeaderButton } from '@/components/StravaHeaderButton';
import { StatsDialog } from '@/components/StatsDialog';
import { GarminSettingsDialog } from '@/components/GarminSettingsDialog';
import { RwgpsSettingsDialog } from '@/components/RwgpsSettingsDialog';
import { RouteNameDialog } from '@/components/RouteNameDialog';
import { RwgpsSuccessDialog } from '@/components/RwgpsSuccessDialog';
import { RwgpsHeaderButton } from '@/components/RwgpsHeaderButton';
import { HowToDialog } from '@/components/HowToDialog';
import { ExportTipsDialog } from '@/components/ExportTipsDialog';
import { RwgpsLibraryDialog } from '@/components/RwgpsLibraryDialog';
import { RwgpsSaveConfirmDialog } from '@/components/RwgpsSaveConfirmDialog';
import { getCachedRoads, setCachedRoads, clearCachedRoads, getCachedPrecomputedRoads, setCachedPrecomputedRoads, clearCachedPrecomputedRoads } from '@/lib/stravaCache';
import { getAffectedSegmentIndices, applyMovedPoint, insertWaypointAtSegment, removeWaypoint, Waypoint } from '@/lib/pointMove';
import { RouteSnapshot, undo, redo, isFirstPointAfterArea, shouldAddComputedEndpoint } from '@/lib/routeHistory';

const Map = dynamic<any>(() => import('@/components/Map'), {
    ssr: false,
    loading: () => <div className="flex-1 bg-gray-100 flex items-center justify-center">Loading map...</div>
});

import { ElevationProfile } from '@/components/ElevationProfile';
import pkg from '@/package.json';
import { haversineM, toSemicircles } from '@/lib/geometry';
import { shareOrDownloadGpx } from '@/lib/gpxShare';
import { buildGpxCourse } from '@/lib/gpx';
import { missingTiles as missingRoadTiles, bboxForTiles as roadBboxForTiles, tileKey as roadTileKey } from '@/lib/roadTiles';
import { calculateElevationGainLoss, densifyElevationProfile } from '@/lib/elevation';

export default function Home() {
    const [bbox, setBbox] = useState<{ south: number; west: number; north: number; east: number } | null>(null);
    const [route, setRoute] = useState<[number, number, number?, number?][] | null>(null);
    const [elevationData, setElevationData] = useState<any[] | null>(null);
    const [totalDistance, setTotalDistance] = useState<string | null>(null);
    const [hoveredPoint, setHoveredPoint] = useState<{ lat: number; lon: number } | null>(null);
    const [routeHoverPoint, setRouteHoverPoint] = useState<{ lat: number; lon: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<{ message: string; trace?: string } | null>(null);
    const [serviceWarning, setServiceWarning] = useState(false);
    const [stravaRoads, setStravaRoads] = useState<[number, number][][] | null>(null);
    const [precomputedRidden, setPrecomputedRidden] = useState<[number, number][][] | null>(null);
    const [stravaElevations, setStravaElevations] = useState<number[]>([]);
    const [stravaTypes, setStravaTypes] = useState<string[]>([]);
    const [isStravaLoading, setIsStravaLoading] = useState(false);
    const [selectedPoints, setSelectedPoints] = useState<{ lat: number; lon: number; id: string }[]>([]);
    const [manualRoute, setManualRoute] = useState<[number, number][][]>([]);
    const [history, setHistory] = useState<{ points: { lat: number; lon: number; id: string }[], route: [number, number][][], selectionBoxes: { north: number; south: number; east: number; west: number }[], preAreaPointCount: number | null }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [routingOptions, setRoutingOptions] = useState({
        avoidGravel: false,
        avoidHighways: false,
        avoidTrails: false,
        riddenPenalty: 15,
        boxElasticity: 0,
        pointRoutePenalty: 4
    });
    const [showOptions, setShowOptions] = useState(false);
    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [showMobileExport, setShowMobileExport] = useState(false);
    const [allRoads, setAllRoads] = useState<[number, number][][]>([]);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [isLassoMode, setIsLassoMode] = useState(false);
    const [selectionBoxes, setSelectionBoxes] = useState<{ north: number; south: number; east: number; west: number }[]>([]);
    const [selectionPolygons, setSelectionPolygons] = useState<[number, number][][]>([]);
    const [startPoint, setStartPoint] = useState<{ lat: number; lon: number; label: string } | null>(null);
    const startPointRef = useRef<{ lat: number; lon: number } | null>(null);
    const [addressInput, setAddressInput] = useState('');
    const [addressLoading, setAddressLoading] = useState(false);
    const [addressResults, setAddressResults] = useState<{ lat: number; lon: number; label: string }[]>([]);
    const [pickingStart, setPickingStart] = useState(false);
    const pickingStartRef = useRef(false);
    const [showHowTo, setShowHowTo] = useState(false);

    // First-run walkthrough (#20): auto-open once, then remember it was seen.
    useEffect(() => {
        try { if (!localStorage.getItem('streetsweep_seen_tutorial')) setShowHowTo(true); } catch { /* ignore */ }
    }, []);
    const closeHowTo = useCallback(() => {
        setShowHowTo(false);
        try { localStorage.setItem('streetsweep_seen_tutorial', '1'); } catch { /* ignore */ }
    }, []);
    const [isEraserMode, setIsEraserMode] = useState(false);
    const [showStravaSettings, setShowStravaSettings] = useState(false);
    const [stravaCredentials, setStravaCredentials] = useState<any>(undefined);
    const [stravaError, setStravaError] = useState<string | null>(null);
    const [stravaRefreshKey, setStravaRefreshKey] = useState(0);
    const [showStats, setShowStats] = useState(false);
    const [showGarminSettings, setShowGarminSettings] = useState(false);
    const [garminCredentials, setGarminCredentials] = useState<any>(undefined);
    const [isGarminUploading, setIsGarminUploading] = useState(false);
    const [showRwgpsSettings, setShowRwgpsSettings] = useState(false);
    const [rwgpsCredentials, setRwgpsCredentials] = useState<any>(undefined);
    const [isRwgpsUploading, setIsRwgpsUploading] = useState(false);
    const [showRouteNameDialog, setShowRouteNameDialog] = useState(false);
    const [rwgpsUploadResult, setRwgpsUploadResult] = useState<{ routeUrl: string } | null>(null);
    const [showExportTips, setShowExportTips] = useState(false);
    const pendingExportTargetRef = useRef<'garmin' | 'rwgps' | null>(null);
    const pendingRwgpsSaveNameRef = useRef<string | null>(null);
    const [showRwgpsLibrary, setShowRwgpsLibrary] = useState(false);
    const [isLoadingRwgpsRoute, setIsLoadingRwgpsRoute] = useState(false);
    const [rwgpsSourceRouteId, setRwgpsSourceRouteId] = useState<number | null>(null);
    const [showRwgpsSaveConfirm, setShowRwgpsSaveConfirm] = useState(false);
    const RWGPS_HIDE_RECREATE_WARNING_KEY = 'rwgps_hide_recreate_warning';
    const [routeName, setRouteName] = useState('StreetSweep Route');
    const [isImporting, setIsImporting] = useState(false);
    const [isImportedRoute, setIsImportedRoute] = useState(false);
    const importFileRef = useRef<HTMLInputElement>(null);
    const isImportedRouteRef = useRef(false);
    const [activeSteps, setActiveSteps] = useState(0);
    const [isAutoGenerating, setIsAutoGenerating] = useState(false);
    const clickChainRef = useRef<Promise<void>>(Promise.resolve());
    const generateAbortControllerRef = useRef<AbortController | null>(null);
    const roadsAbortControllerRef = useRef<AbortController | null>(null);
    const fetchedRoadTilesRef = useRef<Set<string>>(new Set());
    const roadTileCacheRef = useRef<[number, number][][]>([]);
    const pointsRef = useRef<{ lat: number; lon: number; id: string; status?: 'pending' | 'snapped' }[]>([]);
    const manualRouteRef = useRef<[number, number][][]>([]);
    const historyRef = useRef<{ points: { lat: number; lon: number; id: string; status?: 'pending' | 'snapped' }[], route: [number, number][][], selectionBoxes: { north: number; south: number; east: number; west: number }[], preAreaPointCount: number | null }[]>([]);
    const selectionBoxesRef = useRef<{ north: number; south: number; east: number; west: number }[]>([]);
    const selectionPolygonsRef = useRef<[number, number][][]>([]);
    const preAreaPointCountRef = useRef<number | null>(null);
    const [preAreaPointCount, setPreAreaPointCount] = useState<number | null>(null);
    const historyIndexRef = useRef(-1);
    const bboxRef = useRef<{ south: number; west: number; north: number; east: number } | null>(null);
    const stravaRoadsRef = useRef<[number, number][][] | null>(null);
    const routingOptionsRef = useRef(routingOptions);

    // Keep refs in sync with state for use in stable callbacks
    useEffect(() => {
        bboxRef.current = bbox;
    }, [bbox]);

    useEffect(() => {
        stravaRoadsRef.current = stravaRoads;
    }, [stravaRoads]);

    useEffect(() => {
        selectionBoxesRef.current = selectionBoxes;
    }, [selectionBoxes]);

    useEffect(() => {
        selectionPolygonsRef.current = selectionPolygons;
    }, [selectionPolygons]);

    // Persistent start point (#30): load once, keep a ref in sync.
    useEffect(() => {
        try {
            const saved = localStorage.getItem('streetsweep_start');
            if (saved) {
                const p = JSON.parse(saved);
                if (typeof p?.lat === 'number' && typeof p?.lon === 'number') {
                    setStartPoint(p);
                    setBbox({ south: p.lat - 0.008, north: p.lat + 0.008, west: p.lon - 0.008, east: p.lon + 0.008 });
                }
            }
        } catch { /* ignore malformed storage */ }
    }, []);
    useEffect(() => {
        startPointRef.current = startPoint ? { lat: startPoint.lat, lon: startPoint.lon } : null;
    }, [startPoint]);

    const chooseStart = useCallback((p: { lat: number; lon: number; label: string }) => {
        setStartPoint(p);
        localStorage.setItem('streetsweep_start', JSON.stringify(p));
        setBbox({ south: p.lat - 0.008, north: p.lat + 0.008, west: p.lon - 0.008, east: p.lon + 0.008 });
        setAddressInput('');
        setAddressResults([]);
    }, []);

    // Debounced address autocomplete (#53): fetch candidate matches as the user types.
    useEffect(() => {
        const q = addressInput.trim();
        if (q.length < 3) { setAddressResults([]); return; }
        let cancelled = false;
        setAddressLoading(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetch('/api/geocode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ address: q, limit: 5 })
                });
                const data = await res.json();
                if (!cancelled) setAddressResults(Array.isArray(data.results) ? data.results : []);
            } catch {
                if (!cancelled) setAddressResults([]);
            } finally {
                if (!cancelled) setAddressLoading(false);
            }
        }, 350);
        return () => { cancelled = true; clearTimeout(t); setAddressLoading(false); };
    }, [addressInput]);

    // "Pick on map": the next map click sets the start point instead of a waypoint.
    const handleStartPick = useCallback((lat: number, lon: number) => {
        chooseStart({ lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
        setPickingStart(false);
    }, [chooseStart]);

    useEffect(() => { pickingStartRef.current = pickingStart; }, [pickingStart]);

    const clearStartPoint = useCallback(() => {
        setStartPoint(null);
        localStorage.removeItem('streetsweep_start');
    }, []);

    useEffect(() => {
        routingOptionsRef.current = routingOptions;
    }, [routingOptions]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'p') { setIsSelectionMode(false); setIsLassoMode(false); }
            if (e.key === 'a') { setIsSelectionMode(true); setIsLassoMode(false); }
            if (e.key === 'l') { setIsLassoMode(true); setIsSelectionMode(false); }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        const saved = localStorage.getItem('strava_settings');
        if (saved) {
            setStravaCredentials(JSON.parse(saved));
        } else {
            setStravaCredentials({}); // Set to empty object to signal we've checked localStorage
        }

        const savedGarminEmail = localStorage.getItem('garmin_email');
        setGarminCredentials(savedGarminEmail ? { email: savedGarminEmail } : {});

        const savedRwgpsSettings = localStorage.getItem('rwgps_settings');
        const rwgpsSettings = savedRwgpsSettings ? JSON.parse(savedRwgpsSettings) : {};
        setRwgpsCredentials(rwgpsSettings);

        const pendingRwgpsRoute = sessionStorage.getItem('rwgps_pending_route');
        if (pendingRwgpsRoute) {
            sessionStorage.removeItem('rwgps_pending_route');
            const { route: pendingRoute, name: pendingName } = JSON.parse(pendingRwgpsRoute);
            setRoute(pendingRoute);
            if (pendingName) setRouteName(pendingName);
            if (rwgpsSettings?.accessToken) {
                setShowRouteNameDialog(true);
            }
        }
    }, []);

    useEffect(() => {
        // Don't fetch until we've at least tried to load from localStorage
        if (stravaCredentials === undefined) return;

        // If we have no refreshToken in UI, we haven't connected yet.
        const hasRequired = !!stravaCredentials?.refreshToken;

        if (!hasRequired) {
            console.log('[Strava] No UI credentials configured, skipping initial fetch.');
            return;
        }

        const credentialsKey = JSON.stringify(stravaCredentials);

        setStravaError(null);
        setIsStravaLoading(true);

        const skipCache = stravaRefreshKey > 0;

        getCachedRoads(credentialsKey).then(cached => {
            if (cached && !skipCache) {
                setStravaRoads(cached.roads);
                setStravaElevations(cached.elevations);
                setStravaTypes(cached.types);
                setIsStravaLoading(false);
                return;
            }

            fetch('/api/strava/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stravaCredentials, forceSync: skipCache })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.riddenRoads) {
                        setStravaRoads(data.riddenRoads);
                        const elevs: number[] = data.activityElevations ?? [];
                        setStravaElevations(elevs);
                        const types: string[] = data.activityTypes ?? [];
                        setStravaTypes(types);
                        setCachedRoads(data.riddenRoads, elevs, types, credentialsKey);
                    } else if (data.error) {
                        // Only show the main ErrorDialog if this isn't just a "missing credentials" case
                        // which can happen if someone hasn't configured anything yet.
                        setStravaError(data.error);
                        if (!data.error.includes('Missing Strava credentials')) {
                            setError({ message: data.error, trace: data.trace });
                        }
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch Strava roads:', err);
                    setStravaError(err.message);
                    setError({ message: `Strava Connection Failed: ${err.message}` });
                })
                .finally(() => {
                    setIsStravaLoading(false);
                });
        });
    }, [stravaCredentials, stravaRefreshKey]);

    // Fetch the server-precomputed, deduped ridden-road overlay. It's
    // viewport-independent, so the map draws it instantly with no per-pan wait.
    // This payload can run several MB for a rider with a lot of history, and
    // the server itself only refreshes it on its own ~24h timer — so it's
    // cached client-side (IndexedDB) the same way /api/strava/activities
    // already is, instead of re-fetching the full payload on every page load.
    useEffect(() => {
        if (!stravaCredentials?.refreshToken) { setPrecomputedRidden(null); return; }
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const credentialsKey = JSON.stringify(stravaCredentials);
        const skipCache = stravaRefreshKey > 0;

        const fetchFresh = async () => {
            try {
                const res = await fetch('/api/ridden-roads', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stravaCredentials })
                });
                const data = await res.json();
                if (cancelled || data.error) return;
                if (Array.isArray(data.roads) && data.roads.length > 0) {
                    setPrecomputedRidden(data.roads);
                    setCachedPrecomputedRoads(data.roads, data.refreshedAt ?? null, credentialsKey);
                }
                if ((data.computing || data.refreshing) && !cancelled) timer = setTimeout(fetchFresh, 8000);
            } catch { /* leave client fallback in place */ }
        };

        if (skipCache) {
            fetchFresh();
        } else {
            getCachedPrecomputedRoads(credentialsKey).then(cachedRoads => {
                if (cancelled) return;
                if (cachedRoads) {
                    setPrecomputedRidden(cachedRoads);
                } else {
                    fetchFresh();
                }
            });
        }
        return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }, [stravaCredentials, stravaRefreshKey]);

    const handleBBoxChange = useCallback((newBbox: { south: number; west: number; north: number; east: number }) => {
        setBbox(prev => {
            if (prev &&
                Math.abs(prev.south - newBbox.south) < 0.000001 &&
                Math.abs(prev.north - newBbox.north) < 0.000001 &&
                Math.abs(prev.west - newBbox.west) < 0.000001 &&
                Math.abs(prev.east - newBbox.east) < 0.000001) {
                return prev;
            }
            return newBbox;
        });
    }, []);

    useEffect(() => {
        if (!bbox) return;

        // Tile the viewport (plus a small buffer) at a coarse grid so panning only
        // fetches the newly-revealed tiles instead of re-downloading the whole
        // viewport's road geometry every time — this is the single biggest source
        // of Vercel "Fast Origin Transfer" usage, since /api/roads fires on every
        // pan/zoom (moveend).
        const missing = missingRoadTiles(bbox, fetchedRoadTilesRef.current);

        if (missing.length === 0) {
            // Every tile in view has already been fetched — reuse the accumulated
            // cache, no network request needed.
            if (roadTileCacheRef.current.length > 0) setAllRoads(roadTileCacheRef.current);
            return;
        }

        roadsAbortControllerRef.current?.abort();
        roadsAbortControllerRef.current = new AbortController();
        const signal = roadsAbortControllerRef.current.signal;

        // Fetch only the bounding box covering the missing tiles, not the full viewport.
        const fetchBbox = roadBboxForTiles(missing);

        const timer = setTimeout(() => {
            fetch('/api/roads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bbox: fetchBbox }),
                signal
            })
                .then(res => res.json())
                .then(data => {
                    if (data.roads) {
                        console.log(`[StreetSweep] Received ${data.roads.length} roadmap segments for ${missing.length} new tiles.`);
                        // Keep the previous road set if this fetch came back empty
                        // (transient Overpass hiccup) so ridden-road snapping doesn't
                        // fall back to raw GPS traces.
                        if (data.roads.length > 0) {
                            for (const t of missing) fetchedRoadTilesRef.current.add(roadTileKey(t));
                            roadTileCacheRef.current = roadTileCacheRef.current.concat(data.roads);
                            setAllRoads(roadTileCacheRef.current);
                        }
                        setServiceWarning(!!data.degraded);
                    }
                })
                .catch(err => { if (err.name !== 'AbortError') console.error('Failed to fetch roads:', err); });
        }, 300);

        return () => {
            clearTimeout(timer);
            roadsAbortControllerRef.current?.abort();
        };
    }, [bbox]);

    const handleGenerate = useCallback(async (isSilent = false) => {
        // Don't auto-regenerate while the imported route is the active display
        if (isSilent && isImportedRouteRef.current) return;

        const currentBbox = bboxRef.current;
        if (!currentBbox) {
            if (!isSilent) setError({ message: "Please move the map to set an area." });
            return;
        }
        if (isSilent) setIsAutoGenerating(true);
        else setLoading(true);
        setError(null);

        // Abort previous request if in progress
        if (generateAbortControllerRef.current) {
            generateAbortControllerRef.current.abort();
        }
        generateAbortControllerRef.current = new AbortController();

        try {
            const currentPoints = pointsRef.current;
            const payload = {
                bbox: currentBbox,
                riddenRoads: stravaRoadsRef.current,
                selectedPoints: currentPoints,
                startPoint: startPointRef.current,
                selectionBoxes: selectionBoxesRef.current,
                selectionPolygons: selectionPolygonsRef.current,
                routingOptions: routingOptionsRef.current,
                // Fail-safe: If we don't have at least 2 points (start/end), we shouldn't have a manual route.
                // This prevents "ghost" segments from previous sessions or undo states from polluting area-only requests.
                manualRoute: (currentPoints.length >= 2) ? manualRouteRef.current.flat() : [],
                preAreaPointCount: preAreaPointCountRef.current,
                // Road segments between post-area points (C→D, D→E, ...) so the exit bridge
                // honours all intermediate post-area waypoints, not just the final one.
                exitRoute: (preAreaPointCountRef.current !== null && manualRouteRef.current.length > preAreaPointCountRef.current)
                    ? manualRouteRef.current.slice(preAreaPointCountRef.current).flat()
                    : [],
                // Road segments between pre-area waypoints (A→B, B→C, ...) so the entry bridge
                // walks through intermediate approach points before bridging to the area.
                approachRoute: (preAreaPointCountRef.current !== null && preAreaPointCountRef.current > 1)
                    ? manualRouteRef.current.slice(0, preAreaPointCountRef.current - 1).flat()
                    : []
            };

            console.log('[handleGenerate] Sending request to build route...');

            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: generateAbortControllerRef.current.signal
            });

            const data = await res.json();
            if (!res.ok) {
                if (res.statusText !== 'AbortError') {
                    throw new Error(JSON.stringify(data));
                }
                return;
            }

            if (data.degraded) setServiceWarning(true);
            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                setRoute(feature.geometry.coordinates);
                setElevationData(feature.properties.elevationProfile);
                setTotalDistance(feature.properties.totalDistance);

                // When an area/lasso sweep has no real waypoint placed after it yet,
                // the coverage trail's end is a server-computed point the user has
                // never seen or been able to touch. Materialize it as a real,
                // draggable waypoint (same as any clicked point) so it's visible and
                // the user can drag it to redirect where the sweep ends.
                const hasArea = selectionBoxesRef.current.length > 0 || selectionPolygonsRef.current.length > 0;
                if (shouldAddComputedEndpoint(preAreaPointCountRef.current, pointsRef.current.length, hasArea)) {
                    const coords = feature.geometry.coordinates;
                    if (coords.length > 0) {
                        const [lon, lat] = coords[coords.length - 1];
                        const newPoint = { lat, lon, id: Math.random().toString(36).substr(2, 9), status: 'snapped' as const };
                        pointsRef.current = [...pointsRef.current, newPoint];
                        setSelectedPoints([...pointsRef.current]);
                        const snapshot = { points: [...pointsRef.current], route: [...manualRouteRef.current], selectionBoxes: [...selectionBoxesRef.current], preAreaPointCount: preAreaPointCountRef.current };
                        const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
                        historyRef.current = [...newHistory, snapshot];
                        historyIndexRef.current = historyRef.current.length - 1;
                        setHistory(historyRef.current);
                        setHistoryIndex(historyIndexRef.current);
                    }
                }
            } else {
                if (!isSilent) setError({ message: "No route generated." });
            }
        } catch (e: any) {
            if (e.name === 'AbortError') return;
            
            console.error("API Error:", e);
            let message = e.message;
            let trace = undefined;
            try {
                // Try to parse JSON error from API
                const jsonError = JSON.parse(e.message);
                if (jsonError.error) {
                    message = typeof jsonError.error === 'string'
                        ? jsonError.error
                        : jsonError.error.message ?? JSON.stringify(jsonError.error);
                    trace = jsonError.trace;
                }
                if (jsonError.degraded) setServiceWarning(true);
            } catch {
                // Not JSON, just use message
            }
            setError({ message, trace });
        } finally {
            if (generateAbortControllerRef.current?.signal.aborted) {
                // If this was aborted, don't clear loading yet as a new one is coming
                return;
            }
            setLoading(false);
            setIsAutoGenerating(false);
            generateAbortControllerRef.current = null;
        }
    }, []);

    // Real-time route generation (Issue #12)
    useEffect(() => {
        const hasManualRoute = selectedPoints.length >= 2;
        const hasSelectionBoxes = selectionBoxes.length > 0;
        const hasSelectionPolygons = selectionPolygons.length > 0;

        if (!hasManualRoute && !hasSelectionBoxes && !hasSelectionPolygons) {
            return;
        }

        if (activeSteps > 0) {
            console.log(`[RealTime] Skipping auto-generation: ${activeSteps} steps in progress...`);
            return;
        }

        const timer = setTimeout(() => {
            console.log('[RealTime] Triggering auto-generation...');
            handleGenerate(true);
        }, 1500); // 1.5s debounce to allow for multiple rapid clicks/box draws

        return () => clearTimeout(timer);
    }, [manualRoute, selectionBoxes, selectionPolygons, routingOptions, handleGenerate, selectedPoints.length, activeSteps]);

    const downloadGPX = async () => {
        if (!route) return;
        const gpx = buildGpxCourse(route, routeName);
        await shareOrDownloadGpx(gpx, 'route.gpx');
    };

    const [isFitDownloading, setIsFitDownloading] = useState(false);

    const downloadFIT = async () => {
        if (!route) return;
        setIsFitDownloading(true);
        try {
            const res = await fetch('/api/export/fit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ route, name: routeName }),
            });
            if (!res.ok) throw new Error('FIT export failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${routeName.toLowerCase().replace(/\s+/g, '_')}.fit`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('FIT download error:', err);
        } finally {
            setIsFitDownloading(false);
        }
    };

    const doSendToGarmin = () => {
        if (!route) return;
        setShowGarminSettings(true);
    };

    const handleGarminSend = async (name: string, email: string, password: string) => {
        setRouteName(name);
        setIsGarminUploading(true);
        try {
            const res = await fetch('/api/export/garmin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ route, name, email, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Garmin upload failed');
            setShowGarminSettings(false);
            alert('Route uploaded successfully! It will now appear in your Garmin Courses.');
        } catch (err: any) {
            console.error('Garmin upload error:', err);
            setError({ message: `Garmin Upload Failed: ${err.message}` });
        } finally {
            setIsGarminUploading(false);
        }
    };

    const doSendToRwgps = () => {
        if (!rwgpsCredentials?.accessToken) {
            if (route) {
                sessionStorage.setItem('rwgps_pending_route', JSON.stringify({ route, name: routeName }));
            }
            setShowRwgpsSettings(true);
            return;
        }
        if (!route) return;
        setShowRouteNameDialog(true);
    };

    const EXPORT_TIPS_DISMISSED_KEY = 'streetsweep_hide_export_tips';

    const runExportOrShowTips = (target: 'garmin' | 'rwgps') => {
        let dismissed = false;
        try { dismissed = localStorage.getItem(EXPORT_TIPS_DISMISSED_KEY) === '1'; } catch { /* ignore */ }
        if (dismissed) {
            target === 'garmin' ? doSendToGarmin() : doSendToRwgps();
            return;
        }
        pendingExportTargetRef.current = target;
        setShowExportTips(true);
    };

    const sendToGarmin = () => runExportOrShowTips('garmin');
    const sendToRwgps = () => runExportOrShowTips('rwgps');

    const handleExportTipsContinue = (dontShowAgain: boolean) => {
        if (dontShowAgain) {
            try { localStorage.setItem(EXPORT_TIPS_DISMISSED_KEY, '1'); } catch { /* ignore */ }
        }
        setShowExportTips(false);
        const target = pendingExportTargetRef.current;
        pendingExportTargetRef.current = null;
        if (target === 'garmin') doSendToGarmin();
        else if (target === 'rwgps') doSendToRwgps();
    };

    const doSaveToRwgps = async (name: string) => {
        setIsRwgpsUploading(true);
        try {
            const res = await fetch('/api/rwgps/save-route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ route, name, accessToken: rwgpsCredentials.accessToken, oldRouteId: rwgpsSourceRouteId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'RideWithGPS update failed');
            setRwgpsSourceRouteId(data.routeId);
            setRwgpsUploadResult({ routeUrl: data.routeUrl });
        } catch (err: any) {
            console.error('RideWithGPS update error:', err);
            setError({ message: `RideWithGPS Update Failed: ${err.message}` });
        } finally {
            setIsRwgpsUploading(false);
        }
    };

    const handleRwgpsSaveConfirm = (dontShowAgain: boolean) => {
        if (dontShowAgain) {
            try { localStorage.setItem(RWGPS_HIDE_RECREATE_WARNING_KEY, '1'); } catch { /* ignore */ }
        }
        setShowRwgpsSaveConfirm(false);
        const name = pendingRwgpsSaveNameRef.current;
        pendingRwgpsSaveNameRef.current = null;
        if (name) doSaveToRwgps(name);
    };

    const handleRouteNameConfirm = async (name: string) => {
        setRouteName(name);
        setShowRouteNameDialog(false);

        if (rwgpsSourceRouteId) {
            let dismissed = false;
            try { dismissed = localStorage.getItem(RWGPS_HIDE_RECREATE_WARNING_KEY) === '1'; } catch { /* ignore */ }
            if (dismissed) {
                doSaveToRwgps(name);
            } else {
                pendingRwgpsSaveNameRef.current = name;
                setShowRwgpsSaveConfirm(true);
            }
            return;
        }

        setIsRwgpsUploading(true);
        try {
            const res = await fetch('/api/export/rwgps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ route, name, accessToken: rwgpsCredentials.accessToken }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'RideWithGPS upload failed');
            setRwgpsUploadResult({ routeUrl: data.routeUrl });
        } catch (err: any) {
            console.error('RideWithGPS upload error:', err);
            setError({ message: `RideWithGPS Upload Failed: ${err.message}` });
        } finally {
            setIsRwgpsUploading(false);
        }
    };

    // Shared by file import and RWGPS route loading — both produce the same
    // {coordinates, elevationProfile, totalDistance} shape (RWGPS routes are
    // parsed via the same GPX pipeline /api/import uses).
    const applyParsedRoute = useCallback((data: { coordinates: [number, number, number?][]; elevationProfile: any[]; totalDistance: string }) => {
        const coords = data.coordinates;

        // Build start/end selectedPoints
        const startId = Math.random().toString(36).substr(2, 9);
        const endId = Math.random().toString(36).substr(2, 9);
        const firstCoord = coords[0];
        const lastCoord = coords[coords.length - 1];
        const startPt = { lat: firstCoord[1], lon: firstCoord[0], id: startId, status: 'snapped' as const };
        const endPt   = { lat: lastCoord[1],  lon: lastCoord[0],  id: endId,   status: 'snapped' as const };
        const newPoints = [startPt, endPt];

        // Downsample to ~150 pts for the hitbox — full coords stay in `route` for display.
        // A smaller polyline is much faster to hit-test and avoids interactivity issues.
        const MAX_HITBOX_PTS = 150;
        const step = Math.max(1, Math.floor(coords.length / MAX_HITBOX_PTS));
        const sampledCoords: [number, number][] = [];
        for (let i = 0; i < coords.length; i += step) sampledCoords.push([coords[i][0], coords[i][1]]);
        const lastOrig = coords[coords.length - 1];
        const lastSamp = sampledCoords[sampledCoords.length - 1];
        if (lastSamp[0] !== lastOrig[0] || lastSamp[1] !== lastOrig[1])
            sampledCoords.push([lastOrig[0], lastOrig[1]]);
        const newManualRoute = [sampledCoords];

        // Set route as full coordinate array for display, chevrons, eraser
        const routeCoords: [number, number, number?, number?][] = coords.map(c =>
            c.length === 3 ? [c[0], c[1], c[2]] : [c[0], c[1]]
        );

        // Update refs (source of truth for async callbacks)
        pointsRef.current = newPoints;
        manualRouteRef.current = newManualRoute;
        selectionBoxesRef.current = [];
        preAreaPointCountRef.current = null;
        historyIndexRef.current = 0;
        const snapshot = { points: newPoints, route: newManualRoute, selectionBoxes: [], preAreaPointCount: null };
        historyRef.current = [snapshot];

        // Mark as imported so auto-generation is suppressed
        isImportedRouteRef.current = true;
        setIsImportedRoute(true);

        // Update all state
        setSelectedPoints(newPoints);
        setManualRoute(newManualRoute);
        setSelectionBoxes([]);
        setPreAreaPointCount(null);
        setRoute(routeCoords);
        setElevationData(data.elevationProfile);
        setTotalDistance(data.totalDistance);
        setHistory([snapshot]);
        setHistoryIndex(0);
    }, []);

    const handleImportFile = useCallback(async (file: File) => {
        setIsImporting(true);
        setError(null);
        try {
            const form = new FormData();
            form.append('file', file);
            const res = await fetch('/api/import', { method: 'POST', body: form });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Import failed');
            setRwgpsSourceRouteId(null);
            applyParsedRoute(data);
        } catch (err: any) {
            setError({ message: `Import failed: ${err.message}` });
        } finally {
            setIsImporting(false);
        }
    }, [applyParsedRoute]);

    const handleSelectRwgpsRoute = useCallback(async (routeId: number, routeNameFromLibrary: string) => {
        if (!rwgpsCredentials?.accessToken) return;
        setIsLoadingRwgpsRoute(true);
        setError(null);
        try {
            const res = await fetch('/api/rwgps/load-route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: rwgpsCredentials.accessToken, routeId }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to load route from RideWithGPS');
            applyParsedRoute(data);
            setRwgpsSourceRouteId(routeId);
            setRouteName(data.routeName || routeNameFromLibrary);
            setShowRwgpsLibrary(false);
        } catch (err: any) {
            setError({ message: `RideWithGPS load failed: ${err.message}` });
        } finally {
            setIsLoadingRwgpsRoute(false);
        }
    }, [applyParsedRoute, rwgpsCredentials]);

    const isDraggingRef = useRef(false);

    // Safety net: if a drag ends outside the component (blur, touch cancel, etc.),
    // the ref can get stuck at true. Reset it on any document pointerup.
    useEffect(() => {
        const reset = () => { if (isDraggingRef.current) setTimeout(() => { isDraggingRef.current = false; }, 500); };
        document.addEventListener('pointerup', reset);
        return () => document.removeEventListener('pointerup', reset);
    }, []);

    const handlePointAdd = useCallback((point: { lat: number; lon: number }) => {
        if (isDraggingRef.current) return;
        isImportedRouteRef.current = false;
        setIsImportedRoute(false);

        const currentBbox = bboxRef.current;
        if (!currentBbox) return;

        // De-duplicate: don't add point if it's too close to the last one (prevents drag-ghosting)
        if (pointsRef.current.length > 0) {
            const last = pointsRef.current[pointsRef.current.length - 1];
            const dist = Math.sqrt(Math.pow(last.lat - point.lat, 2) + Math.pow(last.lon - point.lon, 2));
            if (dist < 0.0001) return; // Roughly 10 meters
        }

        // 1. Optimistic Update: Add raw point immediately for "insta-drop" feel
        const newPoint = { ...point, id: Math.random().toString(36).substr(2, 9), status: 'pending' as const };
        const tempIdx = pointsRef.current.length;
        pointsRef.current.push(newPoint);
        setSelectedPoints([...pointsRef.current]);
        setActiveSteps(prev => prev + 1);

        clickChainRef.current = clickChainRef.current.then(async () => {
            try {
                // IMPORTANT: Read from ref to get the correct "last point" in the async sequence.
                // See isFirstPointAfterArea: skip stepping from the pre-area point when this is
                // the first point clicked after an area/lasso was drawn.
                const skipLastPoint = isFirstPointAfterArea(preAreaPointCountRef.current, tempIdx);
                const lastPoint = (tempIdx > 0 && !skipLastPoint) ? pointsRef.current[tempIdx - 1] : null;

                const stepRes = await fetch('/api/step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        point,
                        lastPoint,
                        bbox: currentBbox,
                        // Pass context so the step pathfinder avoids already-traversed streets
                        manualRoute: manualRouteRef.current,
                        riddenRoads: stravaRoadsRef.current,
                        routingOptions: routingOptionsRef.current
                    })
                });
                const stepData = await stepRes.json();

                if (stepData.error) {
                    console.warn('Step failed, keeping point at click position:', stepData.error);
                    // Keep the point at its raw click position rather than rolling back.
                    // The generate API uses selectedPoints[last] as endPoint and will still
                    // route to this location even without a road-following path segment.
                    pointsRef.current[tempIdx] = { ...newPoint, status: 'snapped' as const };
                    setSelectedPoints([...pointsRef.current]);
                    const snapshot = { points: [...pointsRef.current], route: [...manualRouteRef.current], selectionBoxes: [...selectionBoxesRef.current], preAreaPointCount: preAreaPointCountRef.current };
                    historyRef.current = [...historyRef.current.slice(0, historyIndexRef.current + 1), snapshot];
                    historyIndexRef.current = historyRef.current.length - 1;
                    setHistory(historyRef.current);
                    setHistoryIndex(historyIndexRef.current);
                    setManualRoute([...manualRouteRef.current]);
                    return;
                }

                const snappedPoint = { ...stepData.snappedPoint, id: newPoint.id, status: 'snapped' as const };

                // 2. Correct Update: Replace raw point with snapped point in ref and state
                pointsRef.current[tempIdx] = snappedPoint;
                setSelectedPoints([...pointsRef.current]);

                let currentSegments = [...manualRouteRef.current];
                if (stepData.path && stepData.path.length > 0) {
                    currentSegments.push(stepData.path);
                }

                // Update refs (source of truth for subsequent clicks)
                manualRouteRef.current = currentSegments;

                const snapshot = { points: [...pointsRef.current], route: [...currentSegments], selectionBoxes: [...selectionBoxesRef.current], preAreaPointCount: preAreaPointCountRef.current };
                // Truncate history based on current index (for redo safety)
                const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
                historyRef.current = [...newHistory, snapshot];
                historyIndexRef.current = historyRef.current.length - 1;

                // Sync to React state for rendering
                setManualRoute(currentSegments);
                setHistory(historyRef.current);
                setHistoryIndex(historyIndexRef.current);

            } catch (err) {
                console.error('Failed to process click step:', err);
                // Rollback optimistic update on network error
                pointsRef.current.splice(tempIdx, 1);
                setSelectedPoints([...pointsRef.current]);
            } finally {
                setActiveSteps(prev => Math.max(0, prev - 1));
            }
        });
    }, []);

    const handlePointMove = useCallback((idx: number, newLatLng: { lat: number; lon: number }) => {
        const currentBbox = bboxRef.current;
        if (!currentBbox) return;

        // 1. Optimistic Update: Update the waypoint immediately
        const newPoints = [...pointsRef.current];
        const pointId = newPoints[idx].id;
        newPoints[idx] = { ...newLatLng, id: pointId, status: 'pending' };
        pointsRef.current = newPoints;
        setSelectedPoints([...newPoints]);
        setActiveSteps(prev => prev + 1);

        clickChainRef.current = clickChainRef.current.then(async () => {
            try {
                // Determine affected segments based on the current state of points
                const affectedIndices = getAffectedSegmentIndices(idx, pointsRef.current.length);

                const updatedSegments = [...manualRouteRef.current];

                // Snap the moved point (no lastPoint needed — just for snapping, not routing)
                const moveRes = await fetch('/api/step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        point: newLatLng,
                        bbox: currentBbox,
                        riddenRoads: stravaRoadsRef.current,
                        routingOptions: routingOptionsRef.current
                    })
                });
                const moveData = await moveRes.json();
                if (moveData.error) return;

                const snappedMovedPoint = { ...moveData.snappedPoint, id: pointId, status: 'snapped' as const };

                // Use the latest points from the ref to avoid race conditions with point additions
                const newestPoints = applyMovedPoint(pointsRef.current, pointId, snappedMovedPoint);
                if (!newestPoints) return; // Point was removed while waiting
                pointsRef.current = newestPoints;
                setSelectedPoints([...newestPoints]);

                // Fetch new paths for affected segments
                for (const segmentIdx of affectedIndices) {
                    const p1 = newestPoints[segmentIdx];
                    const p2 = newestPoints[segmentIdx + 1];

                    if (!p1 || !p2) continue;

                    const stepRes = await fetch('/api/step', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            point: p2,
                            lastPoint: p1,
                            bbox: currentBbox,
                            // When moving a point, only penalize segments that aren't being recalculated
                            manualRoute: updatedSegments.filter((_, i) => !affectedIndices.includes(i)),
                            riddenRoads: stravaRoadsRef.current,
                            routingOptions: routingOptionsRef.current
                        })
                    });
                    const stepData = await stepRes.json();
                    if (stepData.path) {
                        updatedSegments[segmentIdx] = stepData.path;
                    }
                }

                manualRouteRef.current = updatedSegments;

                const snapshot = { points: [...pointsRef.current], route: [...updatedSegments], selectionBoxes: [...selectionBoxesRef.current], preAreaPointCount: preAreaPointCountRef.current };
                const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
                historyRef.current = [...newHistory, snapshot];
                historyIndexRef.current = historyRef.current.length - 1;

                setManualRoute(updatedSegments);
                setHistory(historyRef.current);
                setHistoryIndex(historyIndexRef.current);

            } catch (err) {
                console.error('Failed to move point:', err);
            } finally {
                setActiveSteps(prev => Math.max(0, prev - 1));
            }
        });
    }, []);

    const handlePointMoveStart = useCallback(() => {
        isDraggingRef.current = true;
    }, []);

    const handlePointMoveEnd = useCallback(() => {
        // Delay resetting the flag to ensure any following click events are ignored
        setTimeout(() => {
            isDraggingRef.current = false;
        }, 500); // Increased timeout to be safer
    }, []);

    const handlePointDelete = useCallback((idx: number) => {
        const currentBbox = bboxRef.current;
        if (!currentBbox) return;
        if (idx < 0 || idx >= pointsRef.current.length) return;

        const { newPoints, newRoute, segmentToRoute } = removeWaypoint(pointsRef.current, manualRouteRef.current, idx);
        pointsRef.current = newPoints;
        manualRouteRef.current = newRoute;
        setSelectedPoints([...newPoints]);
        setManualRoute([...newRoute]);

        const commitSnapshot = () => {
            const snapshot = { points: [...pointsRef.current], route: [...manualRouteRef.current], selectionBoxes: [...selectionBoxesRef.current], preAreaPointCount: preAreaPointCountRef.current };
            const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
            historyRef.current = [...newHistory, snapshot];
            historyIndexRef.current = historyRef.current.length - 1;
            setHistory(historyRef.current);
            setHistoryIndex(historyIndexRef.current);
        };

        if (segmentToRoute === null) {
            commitSnapshot();
            return;
        }

        setActiveSteps(prev => prev + 1);
        clickChainRef.current = clickChainRef.current.then(async () => {
            try {
                const p1 = newPoints[segmentToRoute];
                const p2 = newPoints[segmentToRoute + 1];
                const stepRes = await fetch('/api/step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        point: p2,
                        lastPoint: p1,
                        bbox: currentBbox,
                        manualRoute: newRoute.filter((_, i) => i !== segmentToRoute),
                        riddenRoads: stravaRoadsRef.current,
                        routingOptions: routingOptionsRef.current
                    })
                });
                const stepData = await stepRes.json();
                const updatedSegments = [...manualRouteRef.current];
                if (stepData.path) updatedSegments[segmentToRoute] = stepData.path;
                manualRouteRef.current = updatedSegments;
                setManualRoute(updatedSegments);
                commitSnapshot();
            } catch (err) {
                console.error('Failed to delete point:', err);
            } finally {
                setActiveSteps(prev => Math.max(0, prev - 1));
            }
        });
    }, []);

    const handleRouteSegmentInsert = useCallback((segmentIdx: number, rawPoint: { lat: number; lon: number }) => {
        const wasImported = isImportedRouteRef.current;
        isImportedRouteRef.current = false;
        setIsImportedRoute(false);
        const currentBbox = bboxRef.current;
        if (!currentBbox) return;

        // Clear the imported route display immediately so the old solid line doesn't linger
        if (wasImported) setRoute(null);

        const newId = Math.random().toString(36).substr(2, 9);
        const pendingPoint: Waypoint = { ...rawPoint, id: newId, status: 'pending' };

        // Optimistic insert: split segment into two empty placeholders
        const { newPoints, newRoute } = insertWaypointAtSegment(
            pointsRef.current,
            manualRouteRef.current,
            segmentIdx,
            pendingPoint
        );
        pointsRef.current = newPoints;
        manualRouteRef.current = newRoute;
        setSelectedPoints([...newPoints]);
        setManualRoute([...newRoute]);
        setActiveSteps(prev => prev + 2);

        clickChainRef.current = clickChainRef.current.then(async () => {
            try {
                // Snap the inserted point to the road network
                const snapRes = await fetch('/api/step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        point: rawPoint,
                        bbox: currentBbox,
                        riddenRoads: stravaRoadsRef.current,
                        routingOptions: routingOptionsRef.current,
                    }),
                });
                const snapData = await snapRes.json();
                if (snapData.error) return;

                const snappedPoint: Waypoint = { ...snapData.snappedPoint, id: newId, status: 'snapped' };
                const latestPoints = applyMovedPoint(pointsRef.current, newId, snappedPoint);
                if (!latestPoints) return; // point was removed while snap was in flight
                pointsRef.current = latestPoints;
                setSelectedPoints([...latestPoints]);

                const insertedIdx = latestPoints.findIndex(p => p.id === newId);
                if (insertedIdx === -1) return;

                const updatedSegments = [...manualRouteRef.current];
                const excludeForPenalty = updatedSegments.filter((_, i) => i !== insertedIdx - 1 && i !== insertedIdx);

                // Re-route: points[insertedIdx-1] → snappedPoint
                const pBefore = latestPoints[insertedIdx - 1];
                if (pBefore) {
                    const res = await fetch('/api/step', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            point: snappedPoint,
                            lastPoint: pBefore,
                            bbox: currentBbox,
                            manualRoute: excludeForPenalty,
                            riddenRoads: stravaRoadsRef.current,
                            routingOptions: routingOptionsRef.current,
                        }),
                    });
                    const data = await res.json();
                    if (data.path) updatedSegments[insertedIdx - 1] = data.path;
                }

                // Re-route: snappedPoint → points[insertedIdx+1]
                const pAfter = latestPoints[insertedIdx + 1];
                if (pAfter) {
                    const res = await fetch('/api/step', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            point: pAfter,
                            lastPoint: snappedPoint,
                            bbox: currentBbox,
                            manualRoute: excludeForPenalty,
                            riddenRoads: stravaRoadsRef.current,
                            routingOptions: routingOptionsRef.current,
                        }),
                    });
                    const data = await res.json();
                    if (data.path) updatedSegments[insertedIdx] = data.path;
                }

                manualRouteRef.current = updatedSegments;
                const snapshot = { points: [...pointsRef.current], route: [...updatedSegments], selectionBoxes: [...selectionBoxesRef.current], preAreaPointCount: preAreaPointCountRef.current };
                const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
                historyRef.current = [...newHistory, snapshot];
                historyIndexRef.current = historyRef.current.length - 1;
                setManualRoute(updatedSegments);
                setHistory(historyRef.current);
                setHistoryIndex(historyIndexRef.current);
            } catch (err) {
                console.error('Failed to insert route segment point:', err);
            } finally {
                setActiveSteps(prev => Math.max(0, prev - 2));
            }
        });
    }, []);

    const clearPoints = useCallback(() => {
        // Reset refs
        pointsRef.current = [];
        manualRouteRef.current = [];
        historyRef.current = [];
        historyIndexRef.current = -1;
        clickChainRef.current = Promise.resolve();
        preAreaPointCountRef.current = null;
        isImportedRouteRef.current = false;
        selectionPolygonsRef.current = [];

        // Reset state
        setIsImportedRoute(false);
        setSelectedPoints([]);
        setManualRoute([]);
        setHistory([]);
        setHistoryIndex(-1);
        setRoute(null);
        setElevationData(null);
        setTotalDistance(null);
        setSelectionBoxes([]);
        setSelectionPolygons([]);
        setPreAreaPointCount(null);
        setActiveSteps(0);
        setRwgpsSourceRouteId(null);
    }, []);

    const applySnapshot = useCallback((snapshot: RouteSnapshot, index: number) => {
        pointsRef.current = [...snapshot.points];
        manualRouteRef.current = [...snapshot.route];
        selectionBoxesRef.current = [...snapshot.selectionBoxes];
        preAreaPointCountRef.current = snapshot.preAreaPointCount ?? null;
        historyIndexRef.current = index;

        setSelectedPoints(pointsRef.current);
        setManualRoute(manualRouteRef.current);
        setSelectionBoxes(selectionBoxesRef.current);
        setPreAreaPointCount(preAreaPointCountRef.current);
        setHistoryIndex(index);
    }, []);

    const handleUndo = useCallback(() => {
        const { snapshot, index } = undo(historyRef.current, historyIndexRef.current);
        if (snapshot) applySnapshot(snapshot, index);
        else if (historyIndexRef.current === 0) clearPoints();
    }, [clearPoints, applySnapshot]);

    const handleRedo = useCallback(() => {
        const { snapshot, index } = redo(historyRef.current, historyIndexRef.current);
        if (snapshot) applySnapshot(snapshot, index);
    }, [applySnapshot]);

    const totalElevationGain = useMemo(() => {
        if (!elevationData || elevationData.length < 2) return 0;
        // 15ft hysteresis threshold, calibrated against RWGPS's numbers for a real
        // route — see lib/elevation.ts for why naive per-point summation wildly
        // overstates gain on routes with hundreds of points.
        return calculateElevationGainLoss(elevationData.map(p => p.elevation), 15).gain;
    }, [elevationData]);

    // The fetched elevation samples are deliberately sparse (bounded external
    // API cost), which made the elevation-profile hover marker jump in big
    // steps on the map. Rebuild a much denser profile from the full-res route
    // geometry already in memory, interpolating elevation — no extra fetches.
    const denseElevationData = useMemo(() => {
        if (!elevationData || elevationData.length < 2 || !route || route.length < 2) return elevationData;
        const routeCoords: [number, number][] = route.map(p => [p[0], p[1]]);
        return densifyElevationProfile(routeCoords, elevationData);
    }, [elevationData, route]);

    return (
        <main className="flex flex-col h-app bg-gray-50 overflow-hidden">
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0 z-[1000]">
                <a href="/" title={`v${pkg.version}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center group-hover:bg-indigo-700 transition-colors">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A2 2 0 013 15.414V5.586a2 2 0 012.316-1.97l5.447 1.258a2 2 0 001.374 0l5.447-1.258A2 2 0 0121 5.586v9.828a2 2 0 01-1.236 1.861L15 20l-6-2.586L9 20z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 tracking-tight">StreetSweep</h1>
                </a>


                <div className="hidden md:flex items-center gap-3">
                    <StravaHeaderButton
                        isConnected={!!stravaCredentials?.refreshToken}
                        stravaError={stravaError}
                        isLoading={isStravaLoading}
                        onClick={() => setShowStravaSettings(true)}
                        onRefresh={() => {
                            clearCachedRoads();
                            clearCachedPrecomputedRoads();
                            setStravaRefreshKey(k => k + 1);
                        }}
                    />

                    <RwgpsHeaderButton
                        isConnected={!!rwgpsCredentials?.accessToken}
                        isLoading={isRwgpsUploading}
                        onClick={() => setShowRwgpsSettings(true)}
                    />

                    {rwgpsCredentials?.accessToken && (
                        <button
                            onClick={() => setShowRwgpsLibrary(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm mr-2"
                            title="Browse your RideWithGPS library"
                        >
                            Library
                        </button>
                    )}

                    {stravaRoads && stravaRoads.length > 0 && (
                        <button
                            onClick={() => setShowStats(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
                            title="View coverage stats"
                        >
                            <BarChart3 className="w-4 h-4" />
                            Stats
                        </button>
                    )}

                    <input
                        ref={importFileRef}
                        type="file"
                        accept=".gpx,.tcx,.fit"
                        className="hidden"
                        onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleImportFile(file);
                            e.target.value = '';
                        }}
                    />
                    <button
                        onClick={() => importFileRef.current?.click()}
                        disabled={isImporting}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm disabled:opacity-60"
                        title="Import a GPX, TCX, or FIT route file"
                    >
                        {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                            </svg>
                        )}
                        Import
                    </button>
                    {isImportedRoute && route && (
                        <button
                            onClick={clearPoints}
                            className="flex items-center gap-1 px-2 py-1.5 bg-purple-50 text-purple-700 border border-purple-200 rounded-md text-sm font-medium hover:bg-purple-100 transition-colors"
                            title="Clear imported route"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Imported
                        </button>
                    )}

                    <div className="flex items-center gap-1 mr-2 border-r border-gray-100 pr-3">
                        <button
                            onClick={() => setShowOptions(true)}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium transition-colors border shadow-sm ${showOptions
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                }`}
                            title="Routing Options"
                        >
                            <Settings2 className="w-4 h-4" />
                        </button>

                        {showOptions && (
                            <div
                                className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
                                onClick={() => setShowOptions(false)}
                            >
                                <div
                                    className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 sticky top-0">
                                        <h2 className="text-lg font-bold text-gray-900">Routing Preferences</h2>
                                        <button
                                            onClick={() => setShowOptions(false)}
                                            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>
                                    <div className="p-3 space-y-1">
                                            <div className="px-2 pt-1 pb-2 mb-1 border-b border-gray-100">
                                                <div className="text-[11px] font-semibold text-gray-500 mb-1 flex items-center gap-1.5">
                                                    <HomeIcon className="w-3.5 h-3.5 text-indigo-500" /> Start Address
                                                </div>
                                                {startPoint ? (
                                                    <div className="flex items-center gap-1">
                                                        <span className="flex-1 min-w-0 text-xs text-gray-700 truncate" title={startPoint.label}>
                                                            {startPoint.label.split(',').slice(0, 2).join(',')}
                                                        </span>
                                                        <button onClick={clearStartPoint} title="Clear" className="p-0.5 text-gray-400 hover:text-gray-600">
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="relative">
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                value={addressInput}
                                                                onChange={e => setAddressInput(e.target.value)}
                                                                placeholder="Search address…"
                                                                className="flex-1 min-w-0 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                                            />
                                                            {addressLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
                                                        </div>
                                                        {addressResults.length > 0 && (
                                                            <ul className="mt-1 max-h-40 overflow-y-auto border border-gray-200 rounded bg-white shadow-sm">
                                                                {addressResults.map((r, i) => (
                                                                    <li key={i}>
                                                                        <button
                                                                            onClick={() => chooseStart(r)}
                                                                            className="w-full text-left px-2 py-1.5 text-xs text-gray-700 hover:bg-indigo-50 truncate"
                                                                            title={r.label}
                                                                        >
                                                                            {r.label}
                                                                        </button>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                        <button
                                                            onClick={() => { setPickingStart(true); setShowOptions(false); }}
                                                            className="mt-1.5 w-full px-2 py-1 rounded border border-dashed border-gray-300 text-xs text-gray-600 hover:bg-gray-50"
                                                        >
                                                            Or select a point on the map
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setRoutingOptions({ ...routingOptions, avoidGravel: !routingOptions.avoidGravel })}
                                                className={`w-full px-3 py-2 text-sm rounded-md flex items-center justify-between transition-colors ${routingOptions.avoidGravel ? 'bg-amber-50 text-amber-900' : 'text-gray-700 hover:bg-gray-100'}`}
                                            >
                                                <div className="flex items-center gap-2 text-left">
                                                    <div className={`w-3 h-3 rounded-full border-2 border-white shadow-sm ${routingOptions.avoidGravel ? 'bg-amber-500' : 'bg-gray-200'}`}></div>
                                                    <span>Avoid Gravel</span>
                                                </div>
                                                {routingOptions.avoidGravel && <Check className="w-4 h-4 text-amber-600" />}
                                            </button>
                                            <button
                                                onClick={() => setRoutingOptions({ ...routingOptions, avoidHighways: !routingOptions.avoidHighways })}
                                                className={`w-full px-3 py-2 text-sm rounded-md flex items-center justify-between transition-colors ${routingOptions.avoidHighways ? 'bg-red-50 text-red-900' : 'text-gray-700 hover:bg-gray-100'}`}
                                            >
                                                <div className="flex items-center gap-2 text-left">
                                                    <div className={`w-3 h-3 rounded-full border-2 border-white shadow-sm ${routingOptions.avoidHighways ? 'bg-red-500' : 'bg-gray-200'}`}></div>
                                                    <span>Avoid Highways</span>
                                                </div>
                                                {routingOptions.avoidHighways && <Check className="w-4 h-4 text-red-600" />}
                                            </button>
                                            <button
                                                onClick={() => setRoutingOptions({ ...routingOptions, avoidTrails: !routingOptions.avoidTrails })}
                                                className={`w-full px-3 py-2 text-sm rounded-md flex items-center justify-between transition-colors ${routingOptions.avoidTrails ? 'bg-green-50 text-green-900' : 'text-gray-700 hover:bg-gray-100'}`}
                                            >
                                                <div className="flex items-center gap-2 text-left">
                                                    <div className={`w-3 h-3 rounded-full border-2 border-white shadow-sm ${routingOptions.avoidTrails ? 'bg-green-500' : 'bg-gray-200'}`}></div>
                                                    <span>Avoid Trails</span>
                                                </div>
                                                {routingOptions.avoidTrails && <Check className="w-4 h-4 text-green-600" />}
                                            </button>
                                            <div className="w-full px-3 py-3 border-t border-gray-200">
                                                <label className="text-sm font-medium text-gray-700 mb-2 block">
                                                    Ridden Road Penalty: {routingOptions.riddenPenalty}x
                                                </label>
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="100"
                                                    value={routingOptions.riddenPenalty}
                                                    onChange={(e) => setRoutingOptions({ ...routingOptions, riddenPenalty: parseInt(e.target.value) })}
                                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                                />
                                                <p className="text-xs text-gray-500 mt-2">Higher values strongly prefer unridden roads (less backtracking)</p>
                                            </div>
                                            <div className="w-full px-3 py-3 border-t border-gray-200">
                                                <label className="text-sm font-medium text-gray-700 mb-2 block">
                                                    Point Route Detour Preference: {routingOptions.pointRoutePenalty}x
                                                </label>
                                                <input
                                                    type="range"
                                                    min="1"
                                                    max="20"
                                                    value={routingOptions.pointRoutePenalty}
                                                    onChange={(e) => setRoutingOptions({ ...routingOptions, pointRoutePenalty: parseInt(e.target.value) })}
                                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                                />
                                                <p className="text-xs text-gray-500 mt-2">How far out of your way to go for new streets when routing point-to-point (not area/lasso). Higher values detour more.</p>
                                            </div>
                                            <div className="w-full px-3 py-3 border-t border-gray-200">
                                                <label className="text-sm font-medium text-gray-700 mb-2 block">
                                                    Bounding Box Elasticity: {routingOptions.boxElasticity} ft
                                                </label>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="500"
                                                    step="10"
                                                    value={routingOptions.boxElasticity}
                                                    onChange={(e) => setRoutingOptions({ ...routingOptions, boxElasticity: parseInt(e.target.value) })}
                                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                                />
                                                <p className="text-xs text-gray-500 mt-2">Sweeps streets up to this far past a drawn Area/Lasso box, not just what&apos;s inside it — can add distance to the route</p>
                                            </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-1 mr-2 border-r border-gray-100 pr-3">
                        <button
                            onClick={handleUndo}
                            disabled={historyIndex < 0}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md disabled:text-gray-200 transition-colors"
                            title="Undo last point"
                        >
                            <Undo2 className="w-5 h-5" />
                        </button>
                        <button
                            onClick={handleRedo}
                            disabled={historyIndex >= history.length - 1}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-md disabled:text-gray-200 transition-colors"
                            title="Redo point"
                        >
                            <Redo2 className="w-5 h-5" />
                        </button>
                    </div>
                    {route && (
                        <>
                            <button
                                onClick={downloadGPX}
                                className="flex items-center gap-2 px-4 py-2 max-md:min-h-[44px] bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                GPX
                            </button>
                            <button
                                onClick={downloadFIT}
                                disabled={isFitDownloading}
                                title="Download FIT (Garmin native format)"
                                className="flex items-center gap-2 px-4 py-2 max-md:min-h-[44px] bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 disabled:opacity-60"
                            >
                                {isFitDownloading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                )}
                                FIT
                            </button>
                            <button
                                onClick={sendToGarmin}
                                disabled={isGarminUploading}
                                title="Send to Garmin"
                                className="flex items-center gap-1.5 px-3 py-2 max-md:min-h-[44px] bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 transition-all shadow-sm disabled:opacity-60"
                            >
                                {isGarminUploading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <span>&rarr;</span>
                                )}
                                Garmin
                            </button>
                            <button
                                onClick={sendToRwgps}
                                disabled={isRwgpsUploading}
                                title={rwgpsSourceRouteId ? 'Update on RideWithGPS' : 'Send to RideWithGPS'}
                                className="flex items-center gap-1.5 px-3 py-2 max-md:min-h-[44px] bg-[#FC4C02] text-white rounded-md text-sm font-semibold hover:bg-[#e34402] transition-all shadow-sm disabled:opacity-60"
                            >
                                {isRwgpsUploading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <span>&rarr;</span>
                                )}
                                {rwgpsSourceRouteId ? 'Update RWGPS' : 'RWGPS'}
                            </button>
                        </>
                    )}
                    {(selectedPoints.length > 0 || manualRoute.length > 0 || route || selectionBoxes.length > 0 || selectionPolygons.length > 0) && (
                        <button
                            onClick={clearPoints}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
                        >
                            {(route || selectionBoxes.length > 0 || selectionPolygons.length > 0) ? 'Start Over' : 'Clear Workspace'}
                        </button>
                    )}
                    <button
                        onClick={() => handleGenerate()}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 max-md:min-h-[44px] bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors shadow-sm"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            'Regenerate Route'
                        )}
                    </button>
                </div>

                <div className="flex md:hidden items-center gap-2">
                    <StravaHeaderButton
                        isConnected={!!stravaCredentials?.refreshToken}
                        stravaError={stravaError}
                        isLoading={isStravaLoading}
                        onClick={() => setShowStravaSettings(true)}
                        onRefresh={() => {
                            clearCachedRoads();
                            clearCachedPrecomputedRoads();
                            setStravaRefreshKey(k => k + 1);
                        }}
                    />

                    <div className="relative">
                        <button
                            onClick={() => setShowMobileMenu(!showMobileMenu)}
                            className={`flex items-center justify-center min-h-[44px] min-w-[44px] p-2 rounded-md border shadow-sm transition-colors ${showMobileMenu
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                }`}
                            title="More"
                        >
                            <Menu className="w-5 h-5" />
                        </button>

                        {showMobileMenu && (
                            <>
                                <div
                                    className="fixed inset-0 z-[1001]"
                                    onClick={() => setShowMobileMenu(false)}
                                ></div>
                                <div className="absolute right-0 mt-2 w-60 bg-white border border-gray-200 rounded-lg shadow-xl z-[1002] py-1 origin-top-right overflow-hidden ring-1 ring-black ring-opacity-5">
                                    <button
                                        onClick={() => { setShowRwgpsSettings(true); setShowMobileMenu(false); }}
                                        className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                                    >
                                        {rwgpsCredentials?.accessToken ? 'RideWithGPS' : 'Connect RideWithGPS'}
                                    </button>
                                    {rwgpsCredentials?.accessToken && (
                                        <button
                                            onClick={() => { setShowRwgpsLibrary(true); setShowMobileMenu(false); }}
                                            className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                                        >
                                            RideWithGPS Library
                                        </button>
                                    )}
                                    {stravaRoads && stravaRoads.length > 0 && (
                                        <button
                                            onClick={() => { setShowStats(true); setShowMobileMenu(false); }}
                                            className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                                        >
                                            Stats
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { importFileRef.current?.click(); setShowMobileMenu(false); }}
                                        disabled={isImporting}
                                        className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center disabled:opacity-60"
                                    >
                                        {isImporting ? 'Importing…' : 'Import Route'}
                                    </button>
                                    {isImportedRoute && route && (
                                        <button
                                            onClick={() => { clearPoints(); setShowMobileMenu(false); }}
                                            className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-purple-700 hover:bg-purple-50 flex items-center"
                                        >
                                            Clear Imported Route
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setShowHowTo(true); setShowMobileMenu(false); }}
                                        className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                                    >
                                        How To / About
                                    </button>
                                    <div className="border-t border-gray-100 flex">
                                        <button
                                            onClick={() => { handleUndo(); setShowMobileMenu(false); }}
                                            disabled={historyIndex < 0}
                                            className="flex-1 justify-center px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-300 flex items-center gap-1.5"
                                        >
                                            <Undo2 className="w-4 h-4" /> Undo
                                        </button>
                                        <button
                                            onClick={() => { handleRedo(); setShowMobileMenu(false); }}
                                            disabled={historyIndex >= history.length - 1}
                                            className="flex-1 justify-center px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 disabled:text-gray-300 flex items-center gap-1.5"
                                        >
                                            <Redo2 className="w-4 h-4" /> Redo
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <div className="flex-1 flex flex-col relative min-h-0">
                {/* Mobile bottom action bar (Task D1: Option 2) */}
                <div className="md:hidden absolute inset-x-0 bottom-0 z-[1000] flex items-center gap-2 px-3 pt-2 pb-2 safe-b bg-white/92 backdrop-blur border-t border-gray-200">
                    <button
                        onClick={() => handleGenerate()}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors shadow-sm"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            'Regenerate Route'
                        )}
                    </button>

                    {route && (
                        <>
                            <button
                                onClick={downloadGPX}
                                title="Share GPX"
                                className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all shrink-0"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                GPX
                            </button>

                            <div className="relative shrink-0">
                                <button
                                    onClick={() => setShowMobileExport(!showMobileExport)}
                                    title="More export options"
                                    className="flex items-center justify-center min-h-[44px] min-w-[44px] px-2 py-2 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-all"
                                >
                                    <MoreVertical className="w-4 h-4" />
                                </button>

                                {showMobileExport && (
                                    <>
                                        <div
                                            className="fixed inset-0 z-[1001]"
                                            onClick={() => setShowMobileExport(false)}
                                        ></div>
                                        <div className="absolute right-0 bottom-full mb-2 w-48 bg-white border border-gray-200 rounded-lg shadow-xl z-[1002] py-1 overflow-hidden ring-1 ring-black ring-opacity-5">
                                            <button
                                                onClick={() => { downloadFIT(); setShowMobileExport(false); }}
                                                disabled={isFitDownloading}
                                                className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                                            >
                                                {isFitDownloading ? 'Downloading…' : 'FIT'}
                                            </button>
                                            <button
                                                onClick={() => { sendToGarmin(); setShowMobileExport(false); }}
                                                disabled={isGarminUploading}
                                                className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                                            >
                                                {isGarminUploading ? 'Uploading…' : 'Send to Garmin'}
                                            </button>
                                            <button
                                                onClick={() => { sendToRwgps(); setShowMobileExport(false); }}
                                                disabled={isRwgpsUploading}
                                                className="w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                                            >
                                                {isRwgpsUploading ? 'Uploading…' : rwgpsSourceRouteId ? 'Update on RideWithGPS' : 'Send to RideWithGPS'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </>
                    )}

                    {(selectedPoints.length > 0 || manualRoute.length > 0 || route || selectionBoxes.length > 0 || selectionPolygons.length > 0) && (
                        <button
                            onClick={clearPoints}
                            title={(route || selectionBoxes.length > 0 || selectionPolygons.length > 0) ? 'Start Over' : 'Clear Workspace'}
                            className="flex items-center justify-center min-h-[44px] min-w-[44px] px-2 py-2 bg-white border border-red-200 rounded-md text-red-600 hover:bg-red-50 transition-all shrink-0"
                        >
                            <Eraser className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Routing Status Pill */}
                {((activeSteps > 0 && selectedPoints.length >= 2) || isAutoGenerating) && (
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 backdrop-blur px-5 py-2.5 rounded-full shadow-2xl border border-indigo-100 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300">
                        <div className="relative flex items-center justify-center">
                            <div className="w-3 h-3 bg-indigo-600 rounded-full animate-ping absolute"></div>
                            <Loader2 className="w-4 h-4 animate-spin text-indigo-600 relative z-10" />
                        </div>
                        <span className="text-sm font-bold text-indigo-900 tracking-tight">
                            {isAutoGenerating ? 'Updating route...' : 'Calculating route...'}
                        </span>
                    </div>
                )}
                {/* First-Time User Welcome: prompt to connect Strava */}
                {stravaCredentials !== undefined && !stravaCredentials.refreshToken && (
                    <div className="absolute inset-0 z-[1100] backdrop-blur-md bg-white/40 flex flex-col items-center justify-center p-4">
                        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-lg text-center border border-gray-100 animate-in fade-in zoom-in duration-300 relative">
                            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100 mx-auto mb-6">
                                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A2 2 0 013 15.414V5.586a2 2 0 012.316-1.97l5.447 1.258a2 2 0 001.374 0l5.447-1.258A2 2 0 0121 5.586v9.828a2 2 0 01-1.236 1.861L15 20l-6-2.586L9 20z" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-4 tracking-tight">Welcome to StreetSweep</h2>
                            <div className="text-gray-600 mb-8 font-medium leading-relaxed space-y-4 text-left">
                                <p>
                                    <strong>Street Sweep</strong> helps cyclists, runners, and hikers explore new areas they have not previously traveled.
                                    Connect your Strava account to import all your activities which will be displayed on a single map.
                                    StreetSweep will then help you generate optimized routes, previously untraveled by you, with minimal backtracking.
                                </p>
                                <p className="text-indigo-600 text-sm italic">
                                    To get started creating your custom routes, we need to connect your Strava account to synchronize your activity data.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowStravaSettings(true)}
                                className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-[#FC4C02] text-white rounded-xl text-sm font-bold hover:bg-[#e34402] transition-colors shadow-md shadow-orange-200"
                            >
                                <Settings className="w-4 h-4" />
                                Setup Strava Connection
                            </button>
                        </div>
                    </div>
                )}

                {/* Strava Loading Overlay */}
                {isStravaLoading && (
                    <div className="absolute inset-0 z-[500] backdrop-blur-sm bg-white/30 flex flex-col items-center justify-center p-4">
                        <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-xs text-center border border-gray-100 animate-in fade-in zoom-in duration-300">
                            <div className="w-12 h-12 border-4 border-orange-200 border-t-[#FC4C02] rounded-full animate-spin mx-auto mb-4"></div>
                            <h3 className="text-lg font-bold text-gray-900 tracking-tight">Syncing Strava...</h3>
                            <p className="text-sm text-gray-500 font-medium mt-1">Downloading activities</p>
                        </div>
                    </div>
                )}

                {/* External Service Degradation Warning */}
                {serviceWarning && (
                    <div className="relative z-[1200] bg-orange-50 border-l-4 border-orange-400 px-6 py-3 flex items-center gap-3 shadow-sm">
                        <svg className="w-5 h-5 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-sm font-medium text-orange-800 flex-1">
                            The OpenStreetMap data service is currently experiencing difficulty. Road display and route generation may be impacted.
                        </span>
                        <button onClick={() => setServiceWarning(false)} className="text-orange-400 hover:text-orange-600 ml-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Construction Warning */}
                {route && route.some(p => p.length > 3 && p[3] === 1) && (
                    <div className="relative z-[1200] bg-amber-50 border-l-4 border-amber-400 px-6 py-3 flex items-center gap-3 shadow-sm">
                        <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-sm font-medium text-amber-800">
                            This route may have construction happening
                        </span>
                    </div>
                )}
                {pickingStart && (
                    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 bg-indigo-600 text-white rounded-full shadow-lg px-4 py-1.5 text-sm font-medium">
                        <HomeIcon className="w-4 h-4" /> Click the map to set your start point
                        <button onClick={() => setPickingStart(false)} className="ml-1 text-white/80 hover:text-white"><X className="w-4 h-4" /></button>
                    </div>
                )}

                {/* Edit Mode Controls - overlay top-right of map */}
                <div className="absolute top-4 right-4 z-[1000] flex items-center gap-1">
                    <div className="flex items-center rounded-md border border-gray-300 overflow-hidden text-sm font-medium bg-white shadow-md">
                        <button
                            onClick={() => { setIsSelectionMode(false); setIsLassoMode(false); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 max-md:min-h-[44px] transition-colors ${!isSelectionMode && !isLassoMode ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            title="Point Mode (P)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                            </svg>
                            Point
                        </button>
                        <button
                            onClick={() => { setIsSelectionMode(true); setIsLassoMode(false); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 max-md:min-h-[44px] border-l border-gray-300 transition-colors ${isSelectionMode && !isLassoMode ? 'bg-amber-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            title="Area Selection (A)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                            </svg>
                            Area
                        </button>
                        <button
                            onClick={() => { setIsLassoMode(true); setIsSelectionMode(false); }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 max-md:min-h-[44px] border-l border-gray-300 transition-colors ${isLassoMode ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                            title="Lasso Selection (L)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            Lasso
                        </button>
                    </div>
                    {(selectionBoxes.length > 0 || selectionPolygons.length > 0) && (
                        <button
                            onClick={() => { setSelectionBoxes([]); setSelectionPolygons([]); }}
                            className="flex items-center gap-1.5 px-2 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-md text-sm font-medium hover:bg-red-100 transition-colors shadow-md"
                            title="Clear selection area"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>

                <Map
                    bbox={bbox}
                    onBBoxChange={handleBBoxChange}
                    route={route}
                    hoveredPoint={hoveredPoint}
                    stravaRoads={stravaRoads}
                    precomputedRidden={precomputedRidden}
                    startPoint={startPoint}
                    isPickingStart={pickingStart}
                    onStartPick={handleStartPick}
                    selectedPoints={selectedPoints}
                    onPointAdd={handlePointAdd}
                    onPointMove={handlePointMove}
                    onPointMoveStart={handlePointMoveStart}
                    onPointMoveEnd={handlePointMoveEnd}
                    onPointDelete={handlePointDelete}
                    onRouteSegmentInsert={handleRouteSegmentInsert}
                    manualRoute={manualRoute}
                    allRoads={allRoads}
                    isSelectionMode={isSelectionMode}
                    isLassoMode={isLassoMode}
                    selectionBoxes={selectionBoxes}
                    selectionPolygons={selectionPolygons}
                    preAreaPointCount={preAreaPointCount}
                    onSelectionChange={(box: { north: number; south: number; east: number; west: number } | null) => {
                        if (box) {
                            const newBoxes = [...selectionBoxesRef.current, box];
                            selectionBoxesRef.current = newBoxes;
                            setSelectionBoxes(newBoxes);
                            // Lock in how many approach points existed when the first box was drawn
                            if (preAreaPointCountRef.current === null) {
                                preAreaPointCountRef.current = pointsRef.current.length;
                                setPreAreaPointCount(pointsRef.current.length);
                            }
                            const snapshot = { points: [...pointsRef.current], route: [...manualRouteRef.current], selectionBoxes: newBoxes, preAreaPointCount: preAreaPointCountRef.current };
                            const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
                            historyRef.current = [...newHistory, snapshot];
                            historyIndexRef.current = historyRef.current.length - 1;
                            setHistory(historyRef.current);
                            setHistoryIndex(historyIndexRef.current);
                        } else {
                            setSelectionBoxes([]);
                        }
                    }}
                    onSelectionPolygonChange={(polygon: [number, number][] | null) => {
                        if (polygon) {
                            const newPolygons = [...selectionPolygons, polygon];
                            setSelectionPolygons(newPolygons);
                            // Lock in how many approach points existed when the first polygon was drawn
                            if (preAreaPointCountRef.current === null) {
                                preAreaPointCountRef.current = pointsRef.current.length;
                                setPreAreaPointCount(pointsRef.current.length);
                            }
                        }
                    }}
                    onSelectionModeChange={setIsSelectionMode}
                    onLassoModeChange={setIsLassoMode}
                    isEraserMode={isEraserMode}
                    onRouteUpdate={setRoute}
                    isImportedRoute={isImportedRoute}
                    onRouteHover={setRouteHoverPoint}
                />

                {elevationData && (
                    <ElevationProfile
                        data={denseElevationData ?? elevationData}
                        onHover={setHoveredPoint}
                        totalDistance={totalDistance}
                        totalElevationGain={totalElevationGain}
                        highlightPoint={routeHoverPoint}
                    />
                )}

                <StravaSettingsDialog
                    isOpen={showStravaSettings}
                    onClose={() => setShowStravaSettings(false)}
                    onSave={(creds) => {
                        setStravaCredentials(creds);
                        // No need to close, let them see the "Saved!" state
                    }}
                />

                <GarminSettingsDialog
                    isOpen={showGarminSettings}
                    initialName={routeName}
                    onClose={() => setShowGarminSettings(false)}
                    onSend={handleGarminSend}
                    isSending={isGarminUploading}
                />

                <RwgpsSettingsDialog
                    isOpen={showRwgpsSettings}
                    onClose={() => setShowRwgpsSettings(false)}
                    isConnected={!!rwgpsCredentials?.accessToken}
                />

                {rwgpsCredentials?.accessToken && (
                    <RwgpsLibraryDialog
                        isOpen={showRwgpsLibrary}
                        onClose={() => setShowRwgpsLibrary(false)}
                        accessToken={rwgpsCredentials.accessToken}
                        isLoadingRoute={isLoadingRwgpsRoute}
                        onSelectRoute={handleSelectRwgpsRoute}
                    />
                )}

                <RwgpsSaveConfirmDialog
                    isOpen={showRwgpsSaveConfirm}
                    onClose={() => { setShowRwgpsSaveConfirm(false); pendingRwgpsSaveNameRef.current = null; }}
                    onContinue={handleRwgpsSaveConfirm}
                />

                <RouteNameDialog
                    isOpen={showRouteNameDialog}
                    initialName={routeName}
                    onClose={() => setShowRouteNameDialog(false)}
                    onConfirm={handleRouteNameConfirm}
                />

                <ExportTipsDialog
                    isOpen={showExportTips}
                    onClose={() => { setShowExportTips(false); pendingExportTargetRef.current = null; }}
                    onContinue={handleExportTipsContinue}
                />

                {rwgpsUploadResult && (
                    <RwgpsSuccessDialog
                        routeUrl={rwgpsUploadResult.routeUrl}
                        onClose={() => setRwgpsUploadResult(null)}
                    />
                )}

                <StatsDialog
                    isOpen={showStats}
                    onClose={() => setShowStats(false)}
                    riddenRoads={stravaRoads}
                    activityElevations={stravaElevations}
                    activityTypes={stravaTypes}
                    stravaCredentials={stravaCredentials}
                />

                {error && (
                    <ErrorDialog
                        message={error.message}
                        trace={error.trace}
                        onClose={() => setError(null)}
                    />
                )}

                <HowToDialog isOpen={showHowTo} onClose={closeHowTo} />
                <button
                    onClick={() => setShowHowTo(true)}
                    title="How to use StreetSweep"
                    className={`fixed ${elevationData ? 'bottom-[13rem]' : 'bottom-12'} left-4 z-[1100] w-9 h-9 rounded-full bg-white border border-gray-200 shadow-lg text-indigo-600 font-bold hover:bg-gray-50 flex items-center justify-center transition-[bottom]`}
                >
                    ?
                </button>
            </div>
        </main>
    );
}
