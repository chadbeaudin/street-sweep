'use client';

import { ErrorDialog } from '@/components/ErrorDialog';
import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Undo2, Redo2, Settings2, Check, ChevronDown, Eraser, Settings } from 'lucide-react';
import { StravaSettingsDialog } from '@/components/StravaSettingsDialog';
import { StravaHeaderButton } from '@/components/StravaHeaderButton';
import { GarminSettingsDialog } from '@/components/GarminSettingsDialog';

const Map = dynamic<any>(() => import('@/components/Map'), {
    ssr: false,
    loading: () => <div className="flex-1 bg-gray-100 flex items-center justify-center">Loading map...</div>
});

import { ElevationProfile } from '@/components/ElevationProfile';
import pkg from '@/package.json';
import { haversineM, toSemicircles } from '@/lib/geometry';

export default function Home() {
    const [bbox, setBbox] = useState<{ south: number; west: number; north: number; east: number } | null>(null);
    const [route, setRoute] = useState<[number, number, number?, number?][] | null>(null);
    const [elevationData, setElevationData] = useState<any[] | null>(null);
    const [totalDistance, setTotalDistance] = useState<string | null>(null);
    const [hoveredPoint, setHoveredPoint] = useState<{ lat: number; lon: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<{ message: string; trace?: string } | null>(null);
    const [stravaRoads, setStravaRoads] = useState<[number, number][][] | null>(null);
    const [isStravaLoading, setIsStravaLoading] = useState(false);
    const [selectedPoints, setSelectedPoints] = useState<{ lat: number; lon: number; id: string }[]>([]);
    const [manualRoute, setManualRoute] = useState<[number, number][][]>([]);
    const [history, setHistory] = useState<{ points: { lat: number; lon: number; id: string }[], route: [number, number][][] }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [routingOptions, setRoutingOptions] = useState({
        avoidGravel: false,
        avoidHighways: false,
        avoidTrails: false
    });
    const [showOptions, setShowOptions] = useState(false);
    const [allRoads, setAllRoads] = useState<[number, number][][]>([]);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectionBoxes, setSelectionBoxes] = useState<{ north: number; south: number; east: number; west: number }[]>([]);
    const [isEraserMode, setIsEraserMode] = useState(false);
    const [showStravaSettings, setShowStravaSettings] = useState(false);
    const [stravaCredentials, setStravaCredentials] = useState<any>(undefined);
    const [stravaError, setStravaError] = useState<string | null>(null);
    const [showAbout, setShowAbout] = useState(false);
    const [showGarminSettings, setShowGarminSettings] = useState(false);
    const [garminCredentials, setGarminCredentials] = useState<any>(undefined);
    const [isGarminUploading, setIsGarminUploading] = useState(false);
    const [routeName, setRouteName] = useState('StreetSweep Route');
    const [activeSteps, setActiveSteps] = useState(0);
    const [isAutoGenerating, setIsAutoGenerating] = useState(false);
    const clickChainRef = useRef<Promise<void>>(Promise.resolve());
    const generateAbortControllerRef = useRef<AbortController | null>(null);
    const pointsRef = useRef<{ lat: number; lon: number; id: string; status?: 'pending' | 'snapped' }[]>([]);
    const manualRouteRef = useRef<[number, number][][]>([]);
    const historyRef = useRef<{ points: { lat: number; lon: number; id: string; status?: 'pending' | 'snapped' }[], route: [number, number][][] }[]>([]);
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
        routingOptionsRef.current = routingOptions;
    }, [routingOptions]);

    useEffect(() => {
        const saved = localStorage.getItem('strava_settings');
        if (saved) {
            setStravaCredentials(JSON.parse(saved));
        } else {
            setStravaCredentials({}); // Set to empty object to signal we've checked localStorage
        }

        const savedGarmin = localStorage.getItem('garmin_settings');
        if (savedGarmin) {
            setGarminCredentials(JSON.parse(savedGarmin));
        } else {
            setGarminCredentials({});
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

        setStravaError(null);
        setIsStravaLoading(true);
        fetch('/api/strava/activities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stravaCredentials })
        })
            .then(res => res.json())
            .then(data => {
                if (data.riddenRoads) {
                    setStravaRoads(data.riddenRoads);
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
    }, [stravaCredentials]);

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

        const timer = setTimeout(() => {
            fetch('/api/roads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bbox })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.roads) {
                        console.log(`[StreetSweep] Received ${data.roads.length} roadmap segments.`);
                        setAllRoads(data.roads);
                    }
                })
                .catch(err => console.error('Failed to fetch roads:', err));
        }, 300);

        return () => clearTimeout(timer);
    }, [bbox]);

    const handleGenerate = useCallback(async (isSilent = false) => {
        if (!bbox) {
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
            const payload = {
                bbox,
                riddenRoads: stravaRoads,
                selectedPoints,
                selectionBoxes,
                routingOptions,
                // Fail-safe: If we don't have at least 2 points (start/end), we shouldn't have a manual route.
                // This prevents "ghost" segments from previous sessions or undo states from polluting area-only requests.
                manualRoute: (selectedPoints.length >= 2) ? manualRoute.flat() : []
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

            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                setRoute(feature.geometry.coordinates);
                setElevationData(feature.properties.elevationProfile);
                setTotalDistance(feature.properties.totalDistance);
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
                    message = jsonError.error;
                    trace = jsonError.trace;
                }
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
    }, [bbox, stravaRoads, selectedPoints, manualRoute, selectionBoxes, routingOptions]);

    // Real-time route generation (Issue #12)
    useEffect(() => {
        const hasManualRoute = selectedPoints.length >= 2;
        const hasSelectionBoxes = selectionBoxes.length > 0;
        
        if (!hasManualRoute && !hasSelectionBoxes) {
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
    }, [manualRoute, selectionBoxes, routingOptions, handleGenerate, selectedPoints.length, activeSteps]);

    const downloadGPX = () => {
        if (!route) return;

        const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StreetSweep" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${routeName}</name>
    <trkseg>
${route.map(pt => `      <trkpt lat="${pt[1]}" lon="${pt[0]}">${pt[2] !== undefined ? `\n        <ele>${pt[2]}</ele>` : ''}
      </trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;

        const blob = new Blob([gpx], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'route.gpx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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

    const sendToGarmin = async () => {
        if (!route) return;
        if (!garminCredentials?.email || !garminCredentials?.password) {
            setShowGarminSettings(true);
            return;
        }

        setIsGarminUploading(true);
        try {
            const res = await fetch('/api/export/garmin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    route,
                    name: routeName,
                    email: garminCredentials.email,
                    password: garminCredentials.password
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Garmin upload failed');

            // Show success (could be a toast, for now alert)
            alert('Route uploaded successfully! It will now appear in your Garmin Courses.');
        } catch (err: any) {
            console.error('Garmin upload error:', err);
            setError({ message: `Garmin Upload Failed: ${err.message}` });
        } finally {
            setIsGarminUploading(false);
        }
    };

    const isDraggingRef = useRef(false);

    const handlePointAdd = useCallback((point: { lat: number; lon: number }) => {
        if (isDraggingRef.current) return;

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
                // IMPORTANT: Read from ref to get the correct "last point" in the async sequence
                const lastPoint = tempIdx > 0 ? pointsRef.current[tempIdx - 1] : null;

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
                    console.warn('Step failed:', stepData.error);
                    // Rollback optimistic update
                    pointsRef.current.splice(tempIdx, 1);
                    setSelectedPoints([...pointsRef.current]);
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

                const snapshot = { points: [...pointsRef.current], route: [...currentSegments] };
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
                const affectedIndices: number[] = [];
                if (idx > 0) affectedIndices.push(idx - 1); // prev -> moved
                if (idx < pointsRef.current.length - 1) affectedIndices.push(idx); // moved -> next

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
                const newestPoints = [...pointsRef.current];
                const pointIdxInRef = newestPoints.findIndex(p => p.id === pointId);
                if (pointIdxInRef !== -1) {
                    newestPoints[pointIdxInRef] = snappedMovedPoint;
                    pointsRef.current = newestPoints;
                    setSelectedPoints([...newestPoints]);
                } else {
                    return; // Point was removed while waiting
                }

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

                const snapshot = { points: [...pointsRef.current], route: [...updatedSegments] };
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

    const clearPoints = useCallback(() => {
        // Reset refs
        pointsRef.current = [];
        manualRouteRef.current = [];
        historyRef.current = [];
        historyIndexRef.current = -1;
        clickChainRef.current = Promise.resolve();

        // Reset state
        setSelectedPoints([]);
        setManualRoute([]);
        setHistory([]);
        setHistoryIndex(-1);
        setRoute(null);
        setElevationData(null);
        setTotalDistance(null);
        setSelectionBoxes([]);
        setActiveSteps(0);
    }, []);

    const handleUndo = useCallback(() => {
        if (historyIndexRef.current > 0) {
            const prevIndex = historyIndexRef.current - 1;
            const snapshot = historyRef.current[prevIndex];

            // Sync all refs
            pointsRef.current = [...snapshot.points];
            manualRouteRef.current = [...snapshot.route];
            historyIndexRef.current = prevIndex;

            // Sync all state
            setSelectedPoints(pointsRef.current);
            setManualRoute(manualRouteRef.current);
            setHistoryIndex(prevIndex);
        } else if (historyIndexRef.current === 0) {
            clearPoints();
        }
    }, [clearPoints]);
    const handleRedo = useCallback(() => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
            const nextIndex = historyIndexRef.current + 1;
            const snapshot = historyRef.current[nextIndex];

            // Sync all refs
            pointsRef.current = [...snapshot.points];
            manualRouteRef.current = [...snapshot.route];
            historyIndexRef.current = nextIndex;

            // Sync all state
            setSelectedPoints(pointsRef.current);
            setManualRoute(manualRouteRef.current);
            setHistoryIndex(nextIndex);
        }
    }, []);

    const totalElevationGain = useMemo(() => {
        if (!elevationData || elevationData.length < 2) return 0;
        let gain = 0;
        for (let i = 1; i < elevationData.length; i++) {
            const diff = elevationData[i].elevation - elevationData[i - 1].elevation;
            if (diff > 0) gain += diff;
        }
        return Math.round(gain);
    }, [elevationData]);

    return (
        <main className="flex flex-col h-screen bg-gray-50 overflow-hidden">
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0 z-[1000]">
                <a href="/" title={`v${pkg.version}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer group">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center group-hover:bg-indigo-700 transition-colors">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A2 2 0 013 15.414V5.586a2 2 0 012.316-1.97l5.447 1.258a2 2 0 001.374 0l5.447-1.258A2 2 0 0121 5.586v9.828a2 2 0 01-1.236 1.861L15 20l-6-2.586L9 20z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 tracking-tight">StreetSweep</h1>
                </a>

                <div className="flex-1 max-w-xs mx-4">
                    <input
                        type="text"
                        value={routeName}
                        onChange={(e) => setRouteName(e.target.value)}
                        placeholder="Route Name"
                        className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                    />
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 mr-2 border-r border-gray-100 pr-3">
                        <button
                            onClick={() => setIsSelectionMode(!isSelectionMode)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${isSelectionMode
                                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                                }`}
                            title={isSelectionMode ? "Switch to Point mode" : "Switch to Area Select mode"}
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                            </svg>
                            {isSelectionMode ? 'Area Selection' : 'Point Mode'}
                        </button>
                        {selectionBoxes.length > 0 && (
                            <button
                                onClick={() => setSelectionBoxes([])}
                                className="flex items-center gap-1.5 px-2 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-md text-sm font-medium hover:bg-red-100 transition-colors"
                                title="Clear selection area"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    <StravaHeaderButton
                        isConnected={!!stravaCredentials?.refreshToken}
                        stravaError={stravaError}
                        onClick={() => setShowStravaSettings(true)}
                    />

                    <button
                        onClick={() => setShowAbout(true)}
                        className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 shadow-sm"
                    >
                        About
                    </button>

                    <div className="flex items-center gap-1 mr-2 border-r border-gray-100 pr-3">
                        <div className="relative">
                            <button
                                onClick={() => setShowOptions(!showOptions)}
                                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-sm font-medium transition-colors border shadow-sm ${showOptions
                                    ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                    }`}
                                title="Routing Options"
                            >
                                <Settings2 className="w-4 h-4" />
                                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showOptions ? 'rotate-180' : ''}`} />
                            </button>

                            {showOptions && (
                                <>
                                    <div
                                        className="fixed inset-0 z-[1001]"
                                        onClick={() => setShowOptions(false)}
                                    ></div>
                                    <div className="absolute left-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-[1002] py-1 origin-top-left overflow-hidden ring-1 ring-black ring-opacity-5">
                                        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                                            Routing Preferences
                                        </div>
                                        <div className="p-1.5 space-y-1">
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
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
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
                            <div className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-md text-sm font-medium text-indigo-700 flex items-center gap-2">
                                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                                {totalDistance} mi
                            </div>
                            <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-md text-sm font-medium text-emerald-700 flex items-center gap-2" title="Total elevation gain">
                                <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                                {totalElevationGain} ft
                            </div>
                            <button
                                onClick={downloadGPX}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400"
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
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400 disabled:opacity-60"
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
                                title="Send directly to Garmin Connect"
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 transition-all shadow-sm disabled:opacity-60"
                            >
                                {isGarminUploading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                    </svg>
                                )}
                                Send to Garmin
                            </button>
                        </>
                    )}
                    {(selectedPoints.length > 0 || manualRoute.length > 0 || route || selectionBoxes.length > 0) && (
                        <button
                            onClick={clearPoints}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
                        >
                            {(route || selectionBoxes.length > 0) ? 'Start Over' : 'Clear Workspace'}
                        </button>
                    )}
                    <button
                        onClick={() => handleGenerate()}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors shadow-sm"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            'Generate Route'
                        )}
                    </button>
                </div>
            </header>

            <div className="flex-1 flex flex-col relative min-h-0">
                {/* Routing Status Pill */}
                {(activeSteps > 0 || isAutoGenerating) && (
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
                {/* First-Time User Welcome / About Overlay */}
                {(showAbout || (stravaCredentials !== undefined && !stravaCredentials.refreshToken)) && (
                    <div className="absolute inset-0 z-[1100] backdrop-blur-md bg-white/40 flex flex-col items-center justify-center p-4">
                        <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-lg text-center border border-gray-100 animate-in fade-in zoom-in duration-300 relative">
                            {showAbout && (
                                <button
                                    onClick={() => setShowAbout(false)}
                                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                            <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100 mx-auto mb-6">
                                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A2 2 0 013 15.414V5.586a2 2 0 012.316-1.97l5.447 1.258a2 2 0 001.374 0l5.447-1.258A2 2 0 0121 5.586v9.828a2 2 0 01-1.236 1.861L15 20l-6-2.586L9 20z" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-4 tracking-tight">About StreetSweep</h2>
                            <div className="text-gray-600 mb-8 font-medium leading-relaxed space-y-4 text-left">
                                <p>
                                    <strong>Street Sweep</strong> helps cyclists, runners, and hikers explore new areas they have not previously traveled.
                                    Connect your Strava account to import all your activities which will be displayed on a single map.
                                    StreetSweep will then help you generate optimized routes, previously untraveled by you, with minimal backtracking.
                                </p>
                                {!stravaCredentials?.refreshToken && (
                                    <p className="text-indigo-600 text-sm italic">
                                        To get started creating your custom routes, we need to connect your Strava account to synchronize your activity data.
                                    </p>
                                )}
                                <div className="pt-4 mt-4 border-t border-gray-100 flex items-center justify-between">
                                    <div className="text-xs text-gray-400 font-medium">
                                        Version {pkg.version}
                                    </div>
                                    <a 
                                        href="https://github.com/chadbeaudin/street-sweep" 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 font-semibold transition-colors"
                                    >
                                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                                        </svg>
                                        GitHub Repository
                                    </a>
                                </div>
                            </div>
                            {!stravaCredentials?.refreshToken ? (
                                <button
                                    onClick={() => setShowStravaSettings(true)}
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-[#FC4C02] text-white rounded-xl text-sm font-bold hover:bg-[#e34402] transition-colors shadow-md shadow-orange-200"
                                >
                                    <Settings className="w-4 h-4" />
                                    Setup Strava Connection
                                </button>
                            ) : (
                                <button
                                    onClick={() => setShowAbout(false)}
                                    className="w-full px-6 py-3.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-100"
                                >
                                    Got it!
                                </button>
                            )}
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

                {/* Construction Warning */}
                {route && route.some(p => p.length > 3 && p[3] === 1) && (
                    <div className="bg-amber-50 border-l-4 border-amber-400 px-6 py-3 flex items-center gap-3 shadow-sm">
                        <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-sm font-medium text-amber-800">
                            This route may have construction happening
                        </span>
                    </div>
                )}
                <Map
                    bbox={bbox}
                    onBBoxChange={handleBBoxChange}
                    route={route}
                    hoveredPoint={hoveredPoint}
                    stravaRoads={stravaRoads}
                    selectedPoints={selectedPoints}
                    onPointAdd={handlePointAdd}
                    onPointMove={handlePointMove}
                    onPointMoveStart={handlePointMoveStart}
                    onPointMoveEnd={handlePointMoveEnd}
                    manualRoute={manualRoute}
                    allRoads={allRoads}
                    isSelectionMode={isSelectionMode}
                    selectionBoxes={selectionBoxes}
                    onSelectionChange={(box: { north: number; south: number; east: number; west: number } | null) => box ? setSelectionBoxes(prev => [...prev, box]) : setSelectionBoxes([])}
                    onSelectionModeChange={setIsSelectionMode}
                    isEraserMode={isEraserMode}
                    onRouteUpdate={setRoute}
                />

                {elevationData && (
                    <ElevationProfile
                        data={elevationData}
                        onHover={setHoveredPoint}
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
                    onClose={() => setShowGarminSettings(false)}
                    onSave={(creds) => {
                        setGarminCredentials(creds);
                    }}
                />

                {error && (
                    <ErrorDialog
                        message={error.message}
                        trace={error.trace}
                        onClose={() => setError(null)}
                    />
                )}
            </div>
        </main>
    );
}
