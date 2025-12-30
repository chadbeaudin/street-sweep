'use client';

import { ErrorDialog } from '@/components/ErrorDialog';
import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Undo2, Redo2, Settings2, Check, ChevronDown, Eraser, Settings } from 'lucide-react';
import { StravaSettingsDialog } from '@/components/StravaSettingsDialog';

const Map = dynamic<any>(() => import('@/components/Map'), {
    ssr: false,
    loading: () => <div className="flex-1 bg-gray-100 flex items-center justify-center">Loading map...</div>
});

import { ElevationProfile } from '@/components/ElevationProfile';
import pkg from '@/package.json';

export default function Home() {
    const [bbox, setBbox] = useState<{ south: number; west: number; north: number; east: number } | null>(null);
    const [route, setRoute] = useState<[number, number, number?, number?][] | null>(null);
    const [elevationData, setElevationData] = useState<any[] | null>(null);
    const [totalDistance, setTotalDistance] = useState<string | null>(null);
    const [hoveredPoint, setHoveredPoint] = useState<{ lat: number; lon: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<{ message: string; trace?: string } | null>(null);
    const [stravaRoads, setStravaRoads] = useState<[number, number][][] | null>(null);
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
    const [stravaCredentials, setStravaCredentials] = useState<any>(null);
    const [stravaError, setStravaError] = useState<string | null>(null);
    const clickChainRef = useRef<Promise<void>>(Promise.resolve());
    const pointsRef = useRef<{ lat: number; lon: number; id: string }[]>([]);
    const manualRouteRef = useRef<[number, number][][]>([]);
    const historyRef = useRef<{ points: { lat: number; lon: number; id: string }[], route: [number, number][][] }[]>([]);
    const historyIndexRef = useRef(-1);
    const bboxRef = useRef<{ south: number; west: number; north: number; east: number } | null>(null);

    // Keep bboxRef in sync with state for use in stable callbacks
    useEffect(() => {
        bboxRef.current = bbox;
    }, [bbox]);

    useEffect(() => {
        const saved = localStorage.getItem('strava_settings');
        if (saved) setStravaCredentials(JSON.parse(saved));
    }, []);

    useEffect(() => {
        setStravaError(null);
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
                    setStravaError(data.error);
                }
            })
            .catch(err => {
                console.error('Failed to fetch Strava roads:', err);
                setStravaError(err.message);
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

    const handleGenerate = useCallback(async () => {
        if (!bbox) {
            setError({ message: "Please move the map to set an area." });
            return;
        }
        setLoading(true);
        setError(null);
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
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(JSON.stringify(data));
            }

            if (data.features && data.features.length > 0) {
                const feature = data.features[0];
                setRoute(feature.geometry.coordinates);
                setElevationData(feature.properties.elevationProfile);
                setTotalDistance(feature.properties.totalDistance);
            } else {
                setError({ message: "No route generated." });
            }
        } catch (e: any) {
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
            setLoading(false);
        }
    }, [bbox, stravaRoads, selectedPoints, manualRoute, selectionBoxes, routingOptions]);

    const downloadGPX = () => {
        if (!route) return;

        const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StreetSweep" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>StreetSweep Route</name>
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
        const newPoint = { ...point, id: Math.random().toString(36).substr(2, 9) };
        const tempIdx = pointsRef.current.length;
        pointsRef.current.push(newPoint);
        setSelectedPoints([...pointsRef.current]);

        clickChainRef.current = clickChainRef.current.then(async () => {
            try {
                // IMPORTANT: Read from ref to get the correct "last point" in the async sequence
                const lastPoint = tempIdx > 0 ? pointsRef.current[tempIdx - 1] : null;

                const stepRes = await fetch('/api/step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ point, lastPoint, bbox: currentBbox })
                });
                const stepData = await stepRes.json();

                if (stepData.error) {
                    console.warn('Step failed:', stepData.error);
                    // Rollback optimistic update
                    pointsRef.current.splice(tempIdx, 1);
                    setSelectedPoints([...pointsRef.current]);
                    return;
                }

                const snappedPoint = { ...stepData.snappedPoint, id: newPoint.id };

                // 2. Correct Update: Replace raw point with snapped point in ref and state
                pointsRef.current[tempIdx] = snappedPoint;
                setSelectedPoints([...pointsRef.current]);

                let currentSegments = [...manualRouteRef.current];
                if (stepData.path && stepData.path.length > 0) {
                    currentSegments.push(stepData.path);
                } else if (!lastPoint) {
                    // Start of manual route (technically no segment yet, or empty segment)
                    // We don't add a segment for the first point
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
            }
        });
    }, []);

    const handlePointMove = useCallback((idx: number, newLatLng: { lat: number; lon: number }) => {
        const currentBbox = bboxRef.current;
        if (!currentBbox) return;

        // 1. Optimistic Update: Update the waypoint immediately
        const newPoints = [...pointsRef.current];
        const pointId = newPoints[idx].id;
        newPoints[idx] = { ...newLatLng, id: pointId };
        pointsRef.current = newPoints;
        setSelectedPoints([...newPoints]);

        clickChainRef.current = clickChainRef.current.then(async () => {
            try {
                // Determine affected segments based on the current state of points
                const affectedIndices = [];
                if (idx > 0) affectedIndices.push(idx - 1); // prev -> moved
                if (idx < pointsRef.current.length - 1) affectedIndices.push(idx); // moved -> next

                const updatedSegments = [...manualRouteRef.current];

                // Snap the moved point and fetch affected segments
                const moveRes = await fetch('/api/step', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        point: newLatLng,
                        bbox: currentBbox
                    })
                });
                const moveData = await moveRes.json();
                if (moveData.error) return;

                const snappedMovedPoint = { ...moveData.snappedPoint, id: pointId };

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
                            bbox: currentBbox
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

                    {/* Eraser Tool - DISABLED: creates straight line artifacts when removing segments */}
                    {/* {route && (
                        <div className="flex items-center gap-1 mr-2 border-r border-gray-100 pr-3">
                            <button
                                onClick={() => setIsEraserMode(!isEraserMode)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${isEraserMode
                                    ? 'bg-red-100 text-red-700 border border-red-200'
                                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                                    }`}
                                title={isEraserMode ? "Exit Eraser mode" : "Erase route segments"}
                            >
                                <Eraser className="w-4 h-4" />
                                {isEraserMode && 'Eraser Active'}
                            </button>
                        </div>
                    )} */}

                    <div className="flex items-center gap-1 mr-2 border-r border-gray-100 pr-3">
                        <button
                            onClick={() => setShowStravaSettings(true)}
                            className={`flex items-center justify-center w-9 h-9 rounded-md transition-all border shadow-sm ${stravaRoads && stravaRoads.length > 0 && !stravaError
                                ? 'bg-[#FC4C02] border-[#e34402] hover:bg-[#e34402]'
                                : 'bg-white border-gray-300 hover:bg-gray-50'
                                }`}
                            title={stravaError ? `Strava Error: ${stravaError}` : "Strava Settings"}
                        >
                            <svg className={`w-5 h-5 fill-current ${stravaRoads && stravaRoads.length > 0 && !stravaError ? 'text-white' : 'text-gray-400'}`} viewBox="0 0 24 24">
                                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                            </svg>
                        </button>
                    </div>

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
                        onClick={handleGenerate}
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
            </div>
        </main>
    );
}
