'use client';

import React, { useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, Marker, Rectangle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Plus, Minus, LocateFixed } from 'lucide-react';

// Fix for default marker icon in Leaflet + Next.js
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapProps {
    bbox: { south: number; west: number; north: number; east: number } | null;
    onBBoxChange: (bbox: { south: number; west: number; north: number; east: number }) => void;
    route: [number, number, number?, number?][] | null;
    hoveredPoint: { lat: number; lon: number } | null;
    stravaRoads: [number, number][][] | null;
    selectedPoints: { lat: number; lon: number; id: string; status?: 'pending' | 'snapped' }[];
    onPointAdd: (point: { lat: number; lon: number }) => void;
    onPointMove: (idx: number, latlng: { lat: number; lon: number }) => void;
    onPointMoveStart?: () => void;
    onPointMoveEnd?: () => void;
    onRouteSegmentInsert?: (segmentIdx: number, point: { lat: number; lon: number }) => void;
    manualRoute: [number, number][][];
    allRoads: [number, number][][];
    isSelectionMode?: boolean;
    selectionBoxes: { north: number; south: number; east: number; west: number }[];
    onSelectionChange: (box: { north: number; south: number; east: number; west: number } | null) => void;
    onSelectionModeChange?: (isSelectionMode: boolean) => void;
    isEraserMode?: boolean;
    onRouteUpdate?: (route: [number, number, number?, number?][] | null) => void;
    preAreaPointCount?: number | null;
    isImportedRoute?: boolean;
}

function MapEvents({ onBBoxChange, onMapClick }: { onBBoxChange: (bbox: any) => void, onMapClick: (latlng: L.LatLng) => void }) {
    const map = useMap();

    useEffect(() => {
        const handleMove = () => {
            const bounds = map.getBounds();
            onBBoxChange({
                south: bounds.getSouth(),
                west: bounds.getWest(),
                north: bounds.getNorth(),
                east: bounds.getEast(),
            });
        };

        // Initial fetch
        handleMove();

        const handleClick = (e: L.LeafletMouseEvent) => onMapClick(e.latlng);

        map.on('moveend', handleMove);
        map.on('click', handleClick);

        return () => {
            map.off('moveend', handleMove);
            map.off('click', handleClick);
        };
    }, [map, onBBoxChange, onMapClick]);

    return null;
}

function InvalidateSizeOnRoute({ route }: { route: [number, number, number?, number?][] | null }) {
    const map = useMap();
    useEffect(() => {
        if (route && route.length > 0) {
            // Recalculate container size when elevation profile appears/disappears
            map.invalidateSize();
        }
    }, [route, map]);
    return null;
}

import { useGeolocateOnMount } from '../lib/useGeolocate';

function GeolocateOnMount() {
    useGeolocateOnMount();
    return null;
}

function MapRefCapture({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
    const map = useMap();
    useEffect(() => { mapRef.current = map; }, [map, mapRef]);
    return null;
}


interface RouteDragLayerProps {
    manualRoute: [number, number][][];
    onRouteSegmentInsert?: (segmentIdx: number, point: { lat: number; lon: number }) => void;
    onDragStart?: () => void;
    onDragEnd?: () => void;
    isSelectionMode?: boolean;
    isEraserMode?: boolean;
    hideVisualLines?: boolean;
}

function RouteDragLayer({ manualRoute, onRouteSegmentInsert, onDragStart, onDragEnd, isSelectionMode, isEraserMode, hideVisualLines }: RouteDragLayerProps) {
    const map = useMap();
    // ref for synchronous access in event handlers; state for triggering re-renders
    const draggingRef = React.useRef<{ segmentIdx: number } | null>(null);
    const [draggingSegmentIdx, setDraggingSegmentIdx] = React.useState<number | null>(null);
    const [ghostPos, setGhostPos] = React.useState<{ lat: number; lon: number } | null>(null);

    // Re-enable map dragging if the user releases the mouse outside the map container
    React.useEffect(() => {
        const handleWindowMouseUp = () => {
            if (draggingRef.current) {
                draggingRef.current = null;
                map.dragging.enable();
                setDraggingSegmentIdx(null);
                setGhostPos(null);
                onDragEnd?.();
            }
        };
        window.addEventListener('mouseup', handleWindowMouseUp);
        return () => window.removeEventListener('mouseup', handleWindowMouseUp);
    }, [map, onDragEnd]);

    useMapEvents({
        mousemove(e) {
            if (draggingRef.current) setGhostPos({ lat: e.latlng.lat, lon: e.latlng.lng });
        },
        mouseup(e) {
            if (draggingRef.current) {
                const { segmentIdx } = draggingRef.current;
                draggingRef.current = null;
                map.dragging.enable();
                setDraggingSegmentIdx(null);
                setGhostPos(null);
                onDragEnd?.();
                onRouteSegmentInsert?.(segmentIdx, { lat: e.latlng.lat, lon: e.latlng.lng });
            }
        },
    });

    const ghostIcon = React.useMemo(() => L.divIcon({
        className: '',
        html: '<div style="width:12px;height:12px;background:#3B82F6;border:2px solid white;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.4)"></div>',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
    }), []);

    if (isSelectionMode || isEraserMode) return null;

    return (
        <>
            {manualRoute.map((seg, i) => {
                if (seg.length < 2) return null;
                const positions = seg.map(p => [p[1], p[0]] as [number, number]);
                const isBeingDragged = draggingSegmentIdx === i;
                return (
                    <React.Fragment key={`route-seg-${i}`}>
                        {/* Visual dashed line — hidden immediately on mousedown so the old
                            path doesn't linger while the drag is in progress */}
                        {!isBeingDragged && !hideVisualLines && (
                            <Polyline
                                positions={positions}
                                color="#EF4444"
                                weight={4}
                                dashArray="5, 10"
                                opacity={0.8}
                                interactive={false}
                            />
                        )}
                        {/* Invisible wide hitbox — must be rendered even while dragging so
                            Leaflet can still fire the map-level mouseup/mousemove events */}
                        <Polyline
                            positions={positions}
                            color="transparent"
                            weight={12}
                            opacity={0}
                            interactive={true}
                            className="route-segment-hitbox"
                            eventHandlers={{
                                mousedown: (e: any) => {
                                    L.DomEvent.stopPropagation(e);
                                    draggingRef.current = { segmentIdx: i };
                                    map.dragging.disable();
                                    setDraggingSegmentIdx(i);
                                    setGhostPos({ lat: e.latlng.lat, lon: e.latlng.lng });
                                    onDragStart?.();
                                },
                            }}
                        />
                    </React.Fragment>
                );
            })}
            {ghostPos && (
                <Marker
                    position={[ghostPos.lat, ghostPos.lon]}
                    interactive={false}
                    icon={ghostIcon}
                />
            )}
        </>
    );
}

function HoverMarker({ point }: { point: { lat: number; lon: number } | null }) {
    if (!point) return null;

    // Standard Leaflet Icon can be more reliable than CircleMarker in some SVG setups
    const hoverIcon = L.divIcon({
        className: 'custom-hover-icon',
        html: `<div style="
            width: 18px; 
            height: 18px; 
            background: #F59E0B; 
            border: 3px solid white; 
            border-radius: 50%; 
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
            animation: pulse 1s infinite;
        "></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
    });

    return (
        <Marker
            position={[point.lat, point.lon]}
            icon={hoverIcon}
            zIndexOffset={1000}
        />
    );
}

const SelectionTool: React.FC<{
    onSelectionChange: (box: { north: number; south: number; east: number; west: number } | null) => void;
}> = ({ onSelectionChange }) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onSelectionChange(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onSelectionChange]);

    return null;
};

// Helper function to calculate bearing between two points
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Normalize to 0-360
}

// Helper function to find junctions (significant direction changes)
function findNearestJunctions(route: [number, number, number?, number?][], startIndex: number): [number, number] {
    const BEARING_THRESHOLD = 45; // degrees
    const MIN_SEGMENT_LENGTH = 3; // minimum points before we look for a junction

    let leftJunction = 0;
    let rightJunction = route.length - 1;

    // Scan left
    for (let i = startIndex - 1; i >= MIN_SEGMENT_LENGTH; i--) {
        const prevBearing = calculateBearing(route[i - 1][1], route[i - 1][0], route[i][1], route[i][0]);
        const currBearing = calculateBearing(route[i][1], route[i][0], route[i + 1][1], route[i + 1][0]);
        const bearingChange = Math.abs(currBearing - prevBearing);
        const normalizedChange = Math.min(bearingChange, 360 - bearingChange);

        if (normalizedChange > BEARING_THRESHOLD) {
            leftJunction = i;
            break;
        }
    }

    // Scan right  
    for (let i = startIndex + 1; i < route.length - MIN_SEGMENT_LENGTH; i++) {
        const prevBearing = calculateBearing(route[i - 1][1], route[i - 1][0], route[i][1], route[i][0]);
        const currBearing = calculateBearing(route[i][1], route[i][0], route[i + 1][1], route[i + 1][0]);
        const bearingChange = Math.abs(currBearing - prevBearing);
        const normalizedChange = Math.min(bearingChange, 360 - bearingChange);

        if (normalizedChange > BEARING_THRESHOLD) {
            rightJunction = i;
            break;
        }
    }

    return [leftJunction, rightJunction];
}

function EraserTool({ route, onRouteUpdate }: { route: [number, number, number?, number?][], onRouteUpdate?: (route: [number, number, number?, number?][] | null) => void }) {
    const map = useMap();

    React.useEffect(() => {
        if (!route || !onRouteUpdate) return;

        const handleClick = (e: L.LeafletMouseEvent) => {
            const clickPoint = e.latlng;

            // Find closest point on route
            let closestIndex = 0;
            let minDistance = Infinity;

            route.forEach((p, idx) => {
                const pointLatLng = L.latLng(p[1], p[0]);
                const dist = clickPoint.distanceTo(pointLatLng);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestIndex = idx;
                }
            });

            // Only erase if click was reasonably close to the route (within 50 pixels)
            const clickPointPx = map.latLngToContainerPoint(clickPoint);
            const routePointPx = map.latLngToContainerPoint(L.latLng(route[closestIndex][1], route[closestIndex][0]));
            const pixelDist = clickPointPx.distanceTo(routePointPx);

            if (pixelDist > 50) return;

            // Find junctions
            const [leftJunction, rightJunction] = findNearestJunctions(route, closestIndex);

            // Remove segment between junctions
            const newRoute = [
                ...route.slice(0, leftJunction + 1),
                ...route.slice(rightJunction)
            ];

            onRouteUpdate(newRoute.length > 1 ? newRoute : null);
        };

        map.on('click', handleClick);

        // Change cursor
        const container = map.getContainer();
        container.style.cursor = 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'><path fill=\'%23dc2626\' stroke=\'white\' stroke-width=\'1\' d=\'M13 3l3.293 3.293-7 7 1.414 1.414 7-7L21 11V3z\'/><path fill=\'%23dc2626\' stroke=\'white\' stroke-width=\'1\' d=\'M19 14l-4.5 6.5-2.5-2.5-5.5 5.5H3l6.5-6.5-2.5-2.5L13 8z\'/></svg>") 12 12, auto';

        return () => {
            map.off('click', handleClick);
            container.style.cursor = '';
        };
    }, [map, route, onRouteUpdate]);

    return null;
}

const Map: React.FC<MapProps> = ({ bbox, onBBoxChange, route, hoveredPoint, stravaRoads, selectedPoints, onPointAdd, onPointMove, onPointMoveStart, onPointMoveEnd, onRouteSegmentInsert, manualRoute, allRoads, isSelectionMode = false, selectionBoxes, onSelectionChange, onSelectionModeChange, isEraserMode = false, onRouteUpdate, preAreaPointCount, isImportedRoute = false }) => {
    const [drawingBox, setDrawingBox] = React.useState<{ north: number; south: number; east: number; west: number } | null>(null);
    const mapRef = React.useRef<L.Map | null>(null);
    const selectionStartRef = React.useRef<L.Point | null>(null);

    const areaEndPoint = React.useMemo(() => {
        if (!route || route.length === 0 || !selectionBoxes || selectionBoxes.length === 0) return null;
        const last = route[route.length - 1];
        return { lat: last[1], lon: last[0] };
    }, [route, selectionBoxes]);

    // Fit map whenever the route first appears (e.g. after import)
    const prevRouteRef = React.useRef<typeof route>(null);
    React.useEffect(() => {
        const wasEmpty = !prevRouteRef.current || prevRouteRef.current.length === 0;
        const hasRoute = route && route.length > 1;
        if (wasEmpty && hasRoute && mapRef.current) {
            const lats = route!.map(p => p[1]);
            const lons = route!.map(p => p[0]);
            mapRef.current.fitBounds(
                [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
                { padding: [40, 40] }
            );
        }
        prevRouteRef.current = route;
    }, [route]);

    const handleOverlayMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        selectionStartRef.current = L.point(e.clientX - rect.left, e.clientY - rect.top);
    }, []);

    const handleOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!selectionStartRef.current || !mapRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const end = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const startLatLng = mapRef.current.containerPointToLatLng(selectionStartRef.current);
        const endLatLng = mapRef.current.containerPointToLatLng(end);
        setDrawingBox({
            north: Math.max(startLatLng.lat, endLatLng.lat),
            south: Math.min(startLatLng.lat, endLatLng.lat),
            east: Math.max(startLatLng.lng, endLatLng.lng),
            west: Math.min(startLatLng.lng, endLatLng.lng),
        });
    }, []);

    const handleOverlayMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!selectionStartRef.current || !mapRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const end = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const startLatLng = mapRef.current.containerPointToLatLng(selectionStartRef.current);
        const endLatLng = mapRef.current.containerPointToLatLng(end);
        const box = {
            north: Math.max(startLatLng.lat, endLatLng.lat),
            south: Math.min(startLatLng.lat, endLatLng.lat),
            east: Math.max(startLatLng.lng, endLatLng.lng),
            west: Math.min(startLatLng.lng, endLatLng.lng),
        };
        onSelectionChange(box);
        setDrawingBox(null);
        selectionStartRef.current = null;
        setTimeout(() => onSelectionModeChange?.(false), 100);
    }, [onSelectionChange, onSelectionModeChange]);

    React.useEffect(() => {
        if (!isSelectionMode) {
            selectionStartRef.current = null;
            setDrawingBox(null);
            return;
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            selectionStartRef.current = null;
            flushSync(() => setDrawingBox(null));
            onSelectionModeChange?.(false);
        };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [isSelectionMode, onSelectionModeChange]);

    const handleMapClick = useCallback((latlng: L.LatLng) => {
        if (isSelectionMode || isEraserMode) return;
        onPointAdd({ lat: latlng.lat, lon: latlng.lng });
    }, [onPointAdd, isSelectionMode, isEraserMode]);

    // Split route into normal and construction segments
    const { normalSegments, constructionSegments, hasConstruction } = React.useMemo(() => {
        if (!route || route.length === 0) {
            return { normalSegments: [], constructionSegments: [], hasConstruction: false };
        }

        const normal: [number, number][][] = [];
        const construction: [number, number][][] = [];
        let currentNormal: [number, number][] = [];
        let currentConstruction: [number, number][] = [];
        let hasAnyConstruction = false;

        for (let i = 0; i < route.length; i++) {
            const point = route[i];
            const latLng: [number, number] = [point[1], point[0]];

            // Check if this point or the next segment has construction
            // Construction flag would be on the 4th element if present
            const hasConstructionFlag = point.length > 3 && point[3] === 1;

            if (hasConstructionFlag) {
                hasAnyConstruction = true;
                // If we were building a normal segment, save it
                if (currentNormal.length > 0) {
                    normal.push(currentNormal);
                    currentNormal = [];
                }
                currentConstruction.push(latLng);
            } else {
                // If we were building a construction segment, save it
                if (currentConstruction.length > 0) {
                    construction.push(currentConstruction);
                    currentConstruction = [];
                }
                currentNormal.push(latLng);
            }
        }

        // Save any remaining segments
        if (currentNormal.length > 0) normal.push(currentNormal);
        if (currentConstruction.length > 0) construction.push(currentConstruction);

        return { normalSegments: normal, constructionSegments: construction, hasConstruction: hasAnyConstruction };
    }, [route]);

    const buildChevronMarkers = React.useCallback((pts: [number, number][]) => {
        if (pts.length < 2) return [];
        const SPACING_M = 150;
        const markers: { lat: number; lon: number; angle: number }[] = [];
        const toRad = (d: number) => d * Math.PI / 180;
        const toDeg = (r: number) => r * 180 / Math.PI;
        const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const R = 6371000;
            const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        const bearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const dLon = toRad(lon2 - lon1);
            const y = Math.sin(dLon) * Math.cos(toRad(lat2));
            const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
            return (toDeg(Math.atan2(y, x)) + 360) % 360;
        };
        let distSinceLastChevron = SPACING_M / 2;
        for (let i = 1; i < pts.length; i++) {
            const [lon1, lat1] = pts[i - 1];
            const [lon2, lat2] = pts[i];
            const segLen = haversineM(lat1, lon1, lat2, lon2);
            let remaining = segLen; let traveled = 0;
            while (distSinceLastChevron + remaining >= SPACING_M) {
                const overshoot = SPACING_M - distSinceLastChevron;
                traveled += overshoot; remaining -= overshoot; distSinceLastChevron = 0;
                const frac = traveled / segLen;
                markers.push({ lat: lat1 + (lat2 - lat1) * frac, lon: lon1 + (lon2 - lon1) * frac, angle: bearing(lat1, lon1, lat2, lon2) });
            }
            distSinceLastChevron += remaining;
        }
        return markers;
    }, []);

    // Chevron markers: one every ~150m along the full generated route
    const chevronMarkers = React.useMemo(() => {
        if (!route || route.length < 2) return [];
        return buildChevronMarkers(route.map(p => [p[0], p[1]] as [number, number]));
    }, [route, buildChevronMarkers]);



    return (
        <div className="flex-1 relative min-h-0">
            <MapContainer
                center={[39.02, -104.7]}
                zoom={13}
                zoomSnap={1}
                zoomDelta={1}
                wheelPxPerZoomLevel={120}
                wheelDebounceTime={40}
                zoomControl={false}
                className={`absolute inset-0 ${isSelectionMode ? 'selection-mode' : ''} ${isEraserMode ? 'eraser-mode' : ''} ${!isSelectionMode && !isEraserMode ? 'point-mode' : ''}`}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapEvents onBBoxChange={onBBoxChange} onMapClick={handleMapClick} />
                <GeolocateOnMount />
                <InvalidateSizeOnRoute route={route} />
                <MapRefCapture mapRef={mapRef} />

                {/* Escape key handler for selection mode */}
                <SelectionTool onSelectionChange={onSelectionChange} />

                {/* Eraser Tool */}
                {isEraserMode && route && (
                    <EraserTool route={route} onRouteUpdate={onRouteUpdate} />
                )}

                {/* Visible Selection Rectangles - Always visible once selected */}
                {selectionBoxes.map((box, idx) => (
                    <Rectangle
                        key={`selection-box-${idx}`}
                        bounds={[
                            [box.south, box.west],
                            [box.north, box.east]
                        ]}
                        interactive={false}
                        color="#F59E0B"
                        weight={2}
                        fillColor="#F59E0B"
                        fillOpacity={0.2}
                        dashArray="5, 5"
                    />
                ))}

                {/* Currently drawing box */}
                {drawingBox && (
                    <Rectangle
                        bounds={[
                            [drawingBox.south, drawingBox.west],
                            [drawingBox.north, drawingBox.east]
                        ]}
                        interactive={false}
                        color="#F59E0B"
                        weight={2}
                        fillColor="#F59E0B"
                        fillOpacity={0.1}
                        dashArray="2, 2"
                    />
                )}

                {/* Strava roads - visual background */}
                {/* Visual styling: High opacity to look like solid coverage, not heatmap */}
                {stravaRoads && stravaRoads.map((road, idx) => (
                    <Polyline
                        key={`strava-${idx}`}
                        positions={road as [number, number][]}
                        color="#1D4ED8"
                        weight={3}
                        opacity={0.9}
                        interactive={false}
                    />
                ))}

                {/* Generated route - Normal segments */}
                {normalSegments.map((segment, idx) => (
                    <Polyline
                        key={`route-normal-${idx}`}
                        positions={segment}
                        color="#EF4444"
                        weight={5}
                        opacity={0.85}
                        interactive={false}
                    />
                ))}

                {/* Generated route - Construction segments */}
                {constructionSegments.map((segment, idx) => (
                    <Polyline
                        key={`route-construction-${idx}`}
                        positions={segment}
                        color="#F59E0B" // Orange/amber for construction
                        weight={5}
                        opacity={0.9}
                        interactive={false}
                        dashArray="10, 10"
                    />
                ))}

                {/* Directional chevrons along the generated route */}
                {chevronMarkers.map((m, idx) => (
                    <Marker
                        key={`chevron-${idx}`}
                        position={[m.lat, m.lon]}
                        interactive={false}
                        icon={L.divIcon({
                            className: '',
                            html: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${m.angle}deg);display:block;">
                                <polyline points="4,14 8,4 12,14" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.95"/>
                            </svg>`,
                            iconSize: [16, 16],
                            iconAnchor: [8, 8],
                        })}
                    />
                ))}

                {/* Invisible interactive layer for cursor and snapping - Rendered AFTER visual lines to be on top of them */}
                {allRoads && !isSelectionMode && allRoads.map((road, idx) => (
                    <Polyline
                        key={`road-hitbox-${idx}`}
                        positions={road as [number, number][]}
                        color="#3B82F6"
                        weight={15}
                        opacity={0} // Totally invisible, but interactive
                        interactive={!isEraserMode}
                        bubblingMouseEvents={true}
                        className="road-hitbox"
                        eventHandlers={{
                            click: isEraserMode ? undefined : (e) => onPointAdd({ lat: e.latlng.lat, lon: e.latlng.lng }),
                        }}
                    />
                ))}

                {/* Invisible per-segment hitboxes — rendered above road hitboxes so mousedown fires here first */}
                <RouteDragLayer
                    manualRoute={manualRoute}
                    onRouteSegmentInsert={onRouteSegmentInsert}
                    onDragStart={onPointMoveStart}
                    onDragEnd={onPointMoveEnd}
                    isSelectionMode={isSelectionMode}
                    isEraserMode={isEraserMode}
                    hideVisualLines={isImportedRoute || !!(route && selectionBoxes && selectionBoxes.length > 0)}
                />

                {/* Markers for selected points */}
                {selectedPoints.map((point, idx) => {
                    const isFirst = idx === 0;
                    const isPostAreaPoint = preAreaPointCount != null && idx >= preAreaPointCount;
                    const isLast = idx === selectedPoints.length - 1 && (selectionBoxes.length === 0 || isPostAreaPoint);
                    const color = isFirst ? '#10B981' : (isLast ? '#EF4444' : '#3B82F6');

                    const markerIcon = L.divIcon({
                        className: 'custom-point-marker',
                        html: `<div style="
                            width: 14px; 
                            height: 14px; 
                            background: ${color}; 
                            border: 2px solid white; 
                            border-radius: 50%; 
                            box-shadow: 0 0 4px rgba(0,0,0,0.3);
                            ${point.status === 'pending' ? 'animation: pulse 1s infinite;' : ''}
                        "></div>`,
                        iconSize: [14, 14],
                        iconAnchor: [7, 7],
                    });

                    return (
                        <Marker
                            key={point.id}
                            position={[point.lat, point.lon]}
                            icon={markerIcon}
                            draggable={true}
                            zIndexOffset={500}
                            eventHandlers={{
                                dragstart: (e: any) => {
                                    onPointMoveStart?.();
                                },
                                dragend: (e: any) => {
                                    const marker = e.target;
                                    const position = marker.getLatLng();
                                    onPointMove(idx, { lat: position.lat, lon: position.lng });
                                    onPointMoveEnd?.();
                                }
                            }}
                        />
                    );
                })}

                {/* Red end-point dot at the far corner when a selection box is active */}
                {areaEndPoint && (
                    <Marker
                        key="area-end-marker"
                        position={[areaEndPoint.lat, areaEndPoint.lon]}
                        interactive={false}
                        zIndexOffset={600}
                        icon={L.divIcon({
                            className: '',
                            html: '<div style="width:14px;height:14px;background:#EF4444;border:2px solid white;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>',
                            iconSize: [14, 14],
                            iconAnchor: [7, 7],
                        })}
                    />
                )}

                <HoverMarker point={hoveredPoint} />
            </MapContainer>

            {isSelectionMode && (
                <div
                    className="absolute inset-0"
                    style={{ cursor: 'crosshair', zIndex: 999, userSelect: 'none' }}
                    onMouseDown={handleOverlayMouseDown}
                    onMouseMove={handleOverlayMouseMove}
                    onMouseUp={handleOverlayMouseUp}
                />
            )}

            {/* Custom map controls */}
            <div className="absolute bottom-8 right-3 z-[1000] flex flex-col gap-1">
                <button
                    onClick={() => mapRef.current?.zoomIn()}
                    className="w-9 h-9 bg-white rounded shadow-md flex items-center justify-center text-gray-700 hover:bg-gray-100 active:bg-gray-200 border border-gray-300"
                    aria-label="Zoom in"
                >
                    <Plus size={16} />
                </button>
                <button
                    onClick={() => mapRef.current?.zoomOut()}
                    className="w-9 h-9 bg-white rounded shadow-md flex items-center justify-center text-gray-700 hover:bg-gray-100 active:bg-gray-200 border border-gray-300"
                    aria-label="Zoom out"
                >
                    <Minus size={16} />
                </button>
                <button
                    onClick={() => mapRef.current?.locate({ setView: true, maxZoom: 14 })}
                    className="w-9 h-9 bg-white rounded shadow-md flex items-center justify-center text-gray-700 hover:bg-gray-100 active:bg-gray-200 border border-gray-300 mt-1"
                    aria-label="Return to current location"
                >
                    <LocateFixed size={16} />
                </button>
            </div>

            <style jsx global>{`
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.3); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .leaflet-container {
                    cursor: grab !important;
                }
                .leaflet-container.point-mode {
                    cursor: crosshair !important;
                }
                .leaflet-container.selection-mode,
                .leaflet-container.selection-mode path,
                .leaflet-container.selection-mode .road-hitbox {
                    cursor: crosshair !important;
                }
                /* Use specific class for roads to avoid overriding markers */
                .leaflet-container .road-hitbox {
                    cursor: pointer !important;
                    pointer-events: auto !important;
                }
                /* Route segments: grab cursor to signal drag-to-insert */
                .leaflet-container .route-segment-hitbox {
                    cursor: grab !important;
                    pointer-events: auto !important;
                }
                .leaflet-container .route-segment-hitbox:active {
                    cursor: grabbing !important;
                }
                /* Use a specific class for the eraser cursor if needed, but EraserTool.tsx already sets it on the container */
                .leaflet-container.eraser-mode {
                    /* cursor is set via JS in EraserTool */
                }
                /* Markers should show pointer/grab when draggable */
                .leaflet-container .leaflet-marker-icon.leaflet-interactive {
                    cursor: pointer !important;
                }
                .leaflet-container .leaflet-marker-icon.leaflet-interactive:active {
                    cursor: grabbing !important;
                }
            `}</style>
        </div>
    );
};

export default Map;
