'use client';

import { ErrorDialog } from '@/components/ErrorDialog';
import dynamic from 'next/dynamic';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Undo2, Redo2 } from 'lucide-react';

const Map = dynamic<any>(() => import('@/components/Map'), {
    ssr: false,
    loading: () => <div className="flex-1 bg-gray-100 flex items-center justify-center">Loading map...</div>
});

import { ElevationProfile } from '@/components/ElevationProfile';

export default function Home() {
    const [bbox, setBbox] = useState<{ south: number; west: number; north: number; east: number } | null>(null);
    const [route, setRoute] = useState<[number, number, number?][] | null>(null);
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
    const [allRoads, setAllRoads] = useState<[number, number][][]>([]);
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
        fetch('/api/strava/activities')
            .then(res => res.json())
            .then(data => {
                if (data.riddenRoads) {
                    setStravaRoads(data.riddenRoads);
                }
            })
            .catch(err => console.error('Failed to fetch Strava roads:', err));
    }, []);

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
                    if (data.roads) setAllRoads(data.roads);
                })
                .catch(err => console.error('Failed to fetch roads:', err));
        }, 500);

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
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bbox,
                    riddenRoads: stravaRoads,
                    selectedPoints,
                    manualRoute: manualRoute.reduce((acc, seg, i) => {
                        if (i === 0) return seg;
                        // Avoid duplicate points at segment boundaries
                        const lastPoint = acc[acc.length - 1];
                        const firstPoint = seg[0];
                        if (lastPoint && firstPoint && lastPoint[0] === firstPoint[0] && lastPoint[1] === firstPoint[1]) {
                            return [...acc, ...seg.slice(1)];
                        }
                        return [...acc, ...seg];
                    }, [] as [number, number][])
                })
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(JSON.stringify(data));
            }

            // Extract coordinates and profile from the first feature
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
    }, [bbox, stravaRoads, selectedPoints, manualRoute]);

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


    return (
        <main className="flex flex-col h-screen bg-gray-50 overflow-hidden">
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm shrink-0 z-20">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A2 2 0 013 15.414V5.586a2 2 0 012.316-1.97l5.447 1.258a2 2 0 001.374 0l5.447-1.258A2 2 0 0121 5.586v9.828a2 2 0 01-1.236 1.861L15 20l-6-2.586L9 20z" />
                        </svg>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 tracking-tight">StreetSweep</h1>
                </div>

                <div className="flex items-center gap-3">
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
                            <button
                                onClick={downloadGPX}
                                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all hover:border-gray-400"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                GPX
                            </button>
                        </>
                    )}
                    {stravaRoads && (
                        <div className="px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-md text-sm font-medium text-blue-700 flex items-center gap-2">
                            <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l7 13.828h4.172L14.562 2.498" />
                            </svg>
                            {stravaRoads.length} Rides
                        </div>
                    )}
                    {(selectedPoints.length > 0 || route) && (
                        <button
                            onClick={clearPoints}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-red-200 rounded-md text-sm font-medium text-red-600 hover:bg-red-50 transition-all"
                        >
                            {route ? 'Start Over' : 'Clear Points'}
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
                />

                {elevationData && (
                    <ElevationProfile
                        data={elevationData}
                        onHover={setHoveredPoint}
                    />
                )}
            </div>
        </main>
    );
}
