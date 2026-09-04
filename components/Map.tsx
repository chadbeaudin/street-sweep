'use client';

import React, { useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, Marker, Rectangle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Plus, Minus, LocateFixed } from 'lucide-react';
import { dedupeRiddenRoads, combineRiddenOverlay } from '@/lib/riddenRoads';
import { bboxFromLatLngs } from '@/lib/selectionBox';
import { buildChevronMarkers as buildChevronMarkersImpl } from '@/lib/chevrons';

// Fix for default marker icon in Leaflet + Next.js
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Cached per (color, pending) combo instead of rebuilt on every render — a fresh
// L.divIcon each render makes react-leaflet call marker.setIcon() on every update,
// which can collide with Leaflet's own drag-cleanup (finishDrag) and throw.
const pointMarkerIconCache = new globalThis.Map<string, L.DivIcon>();
function getPointMarkerIcon(color: string, pending: boolean): L.DivIcon {
    const key = `${color}|${pending}`;
    let icon = pointMarkerIconCache.get(key);
    if (!icon) {
        icon = L.divIcon({
            className: 'custom-point-marker',
            html: `<div style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 14px;
                height: 14px;
                background: ${color};
                border: 2px solid white;
                border-radius: 50%;
                box-shadow: 0 0 4px rgba(0,0,0,0.3);
                ${pending ? 'animation: pulse 1s infinite;' : ''}
            "></div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });
        pointMarkerIconCache.set(key, icon);
    }
    return icon;
}

interface MapProps {
    bbox: { south: number; west: number; north: number; east: number } | null;
    onBBoxChange: (bbox: { south: number; west: number; north: number; east: number }) => void;
    route: [number, number, number?, number?][] | null;
    hoveredPoint: { lat: number; lon: number } | null;
    stravaRoads: [number, number][][] | null;
    precomputedRidden?: [number, number][][] | null;
    startPoint?: { lat: number; lon: number; label: string } | null;
    isPickingStart?: boolean;
    onStartPick?: (lat: number, lon: number) => void;
    selectedPoints: { lat: number; lon: number; id: string; status?: 'pending' | 'snapped' }[];
    onPointAdd: (point: { lat: number; lon: number }) => void;
    onPointMove: (idx: number, latlng: { lat: number; lon: number }) => void;
    onPointMoveStart?: () => void;
    onPointMoveEnd?: () => void;
    onPointDelete?: (idx: number) => void;
    onRouteSegmentInsert?: (segmentIdx: number, point: { lat: number; lon: number }) => void;
    manualRoute: [number, number][][];
    allRoads: [number, number][][];
    isSelectionMode?: boolean;
    isLassoMode?: boolean;
    selectionBoxes: { north: number; south: number; east: number; west: number }[];
    selectionPolygons: [number, number][][];
    onSelectionChange: (box: { north: number; south: number; east: number; west: number } | null) => void;
    onSelectionPolygonChange?: (polygon: [number, number][] | null) => void;
    onSelectionModeChange?: (isSelectionMode: boolean) => void;
    onLassoModeChange?: (isLassoMode: boolean) => void;
    isEraserMode?: boolean;
    onRouteUpdate?: (route: [number, number, number?, number?][] | null) => void;
    preAreaPointCount?: number | null;
    isImportedRoute?: boolean;
    onRouteHover?: (point: { lat: number; lon: number } | null) => void;
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

function MapRefCapture({ mapRef, onZoomChange }: { mapRef: React.MutableRefObject<L.Map | null>, onZoomChange?: (zoom: number) => void }) {
    const map = useMap();
    useEffect(() => { mapRef.current = map; }, [map, mapRef]);
    useEffect(() => {
        if (!onZoomChange) return;
        onZoomChange(map.getZoom());
        const handler = () => onZoomChange(map.getZoom());
        map.on('zoomend', handler);
        return () => { map.off('zoomend', handler); };
    }, [map, onZoomChange]);
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

function RouteHoverTracker({ route, onRouteHover }: { route: [number, number, number?, number?][], onRouteHover: (point: { lat: number; lon: number } | null) => void }) {
    const map = useMap();
    const lastRef = React.useRef<{ lat: number; lon: number } | null>(null);

    React.useEffect(() => {
        const clearHover = () => {
            if (lastRef.current !== null) {
                lastRef.current = null;
                onRouteHover(null);
            }
        };

        const handleMove = (e: L.LeafletMouseEvent) => {
            // Project the cursor onto each route segment (not just vertices —
            // segments between route points can span a whole block).
            const cosLat = Math.cos(e.latlng.lat * Math.PI / 180);
            const cx = e.latlng.lng * cosLat;
            const cy = e.latlng.lat;
            let best: { lat: number; lon: number } | null = null;
            let bestD = Infinity;
            for (let i = 0; i < route.length - 1; i++) {
                const ax = route[i][0] * cosLat, ay = route[i][1];
                const bx = route[i + 1][0] * cosLat, by = route[i + 1][1];
                const dx = bx - ax, dy = by - ay;
                const lenSq = dx * dx + dy * dy;
                let t = lenSq === 0 ? 0 : ((cx - ax) * dx + (cy - ay) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
                const px = ax + t * dx, py = ay + t * dy;
                const ddx = cx - px, ddy = cy - py;
                const d = ddx * ddx + ddy * ddy;
                if (d < bestD) { bestD = d; best = { lat: py, lon: px / cosLat }; }
            }
            if (!best) return;

            const routePx = map.latLngToContainerPoint(L.latLng(best.lat, best.lon));
            const cursorPx = map.latLngToContainerPoint(e.latlng);
            if (routePx.distanceTo(cursorPx) > 20) {
                clearHover();
                return;
            }
            const last = lastRef.current;
            if (!last || Math.abs(last.lat - best.lat) > 1e-6 || Math.abs(last.lon - best.lon) > 1e-6) {
                lastRef.current = best;
                onRouteHover(best);
            }
        };

        map.on('mousemove', handleMove);
        map.on('mouseout', clearHover);
        return () => {
            map.off('mousemove', handleMove);
            map.off('mouseout', clearHover);
            clearHover();
        };
    }, [map, route, onRouteHover]);

    return null;
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

const Map: React.FC<MapProps> = ({ bbox, onBBoxChange, route, hoveredPoint, stravaRoads, precomputedRidden, startPoint, isPickingStart, onStartPick, selectedPoints, onPointAdd, onPointMove, onPointMoveStart, onPointMoveEnd, onPointDelete, onRouteSegmentInsert, manualRoute, allRoads, isSelectionMode = false, isLassoMode = false, selectionBoxes, selectionPolygons, onSelectionChange, onSelectionPolygonChange, onSelectionModeChange, onLassoModeChange, isEraserMode = false, onRouteUpdate, preAreaPointCount, isImportedRoute = false, onRouteHover }) => {
    const [drawingBox, setDrawingBox] = React.useState<{ north: number; south: number; east: number; west: number } | null>(null);
    const [drawingLasso, setDrawingLasso] = React.useState<[number, number][] | null>(null);
    const mapRef = React.useRef<L.Map | null>(null);
    const [zoom, setZoom] = React.useState(13);
    const selectionStartRef = React.useRef<L.Point | null>(null);
    const isDrawingLassoRef = React.useRef(false);

    const areaEndPoint = React.useMemo(() => {
        if (!route || route.length === 0 || !selectionBoxes || selectionBoxes.length === 0) return null;
        const last = route[route.length - 1];
        return { lat: last[1], lon: last[0] };
    }, [route, selectionBoxes]);

    // Start/end markers for area-only mode (no manual waypoints)
    const routeStartPoint = React.useMemo(() => {
        if (!route || route.length === 0 || selectedPoints.length > 0) return null;
        return { lat: route[0][1], lon: route[0][0] };
    }, [route, selectedPoints]);

    const routeEndPoint = React.useMemo(() => {
        if (!route || route.length === 0 || selectedPoints.length > 0) return null;
        return { lat: route[route.length - 1][1], lon: route[route.length - 1][0] };
    }, [route, selectedPoints]);

    // The ridden overlay: the server-precomputed deduped roads (instant,
    // viewport-independent) plus a fresh viewport-local dedupe of stravaRoads.
    // precomputedRidden is only refreshed on a ~24h timer with no invalidation
    // hook when new activities sync, so on its own it can hide a ride from a
    // few hours ago that the client already knows about — unioning both means
    // the overlay only ever gains coverage as fresher data arrives, never loses it.
    const snappedStravaRoads = React.useMemo(() => {
        const fresh = (stravaRoads && stravaRoads.length > 0 && allRoads && allRoads.length > 0)
            ? dedupeRiddenRoads(stravaRoads, allRoads)
            : [];
        return combineRiddenOverlay(precomputedRidden, fresh);
    }, [precomputedRidden, stravaRoads, allRoads]);

    // Fit map whenever an imported route first appears. Only imports — the
    // user hasn't positioned the map for that route's location yet, unlike
    // clicking points, where they're already looking at where they want to
    // route and don't want the view yanked out from under them.
    const prevRouteRef = React.useRef<typeof route>(null);
    React.useEffect(() => {
        const wasEmpty = !prevRouteRef.current || prevRouteRef.current.length === 0;
        const hasRoute = route && route.length > 1;
        if (wasEmpty && hasRoute && isImportedRoute && mapRef.current) {
            const lats = route!.map(p => p[1]);
            const lons = route!.map(p => p[0]);
            mapRef.current.fitBounds(
                [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
                { padding: [40, 40] }
            );
        }
        prevRouteRef.current = route;
    }, [route, isImportedRoute]);

    // The selection/lasso overlay is a sibling of the Leaflet map container
    // (positioned on top via z-index, not a DOM descendant), so wheel events
    // land on it and never bubble to Leaflet's own scroll-zoom handler — they'd
    // otherwise just be swallowed. Forward them manually, zoomed toward the
    // cursor to match Leaflet's native scroll-wheel behavior (#63).
    const handleOverlayWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!mapRef.current) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const point = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const latlng = mapRef.current.containerPointToLatLng(point);
        const delta = e.deltaY < 0 ? 1 : -1;
        mapRef.current.setZoomAround(latlng, mapRef.current.getZoom() + delta);
    }, []);

    const handleOverlayPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        mapRef.current?.dragging.disable();
        const rect = e.currentTarget.getBoundingClientRect();
        selectionStartRef.current = L.point(e.clientX - rect.left, e.clientY - rect.top);
    }, []);

    const handleOverlayPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!selectionStartRef.current || !mapRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const end = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const startLatLng = mapRef.current.containerPointToLatLng(selectionStartRef.current);
        const endLatLng = mapRef.current.containerPointToLatLng(end);
        setDrawingBox(bboxFromLatLngs(startLatLng, endLatLng));
    }, []);

    const handleOverlayPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!selectionStartRef.current || !mapRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const end = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const startLatLng = mapRef.current.containerPointToLatLng(selectionStartRef.current);
        const endLatLng = mapRef.current.containerPointToLatLng(end);
        const box = bboxFromLatLngs(startLatLng, endLatLng);
        onSelectionChange(box);
        setDrawingBox(null);
        selectionStartRef.current = null;
        mapRef.current?.dragging.enable();
        setTimeout(() => onSelectionModeChange?.(false), 100);
    }, [onSelectionChange, onSelectionModeChange]);

    const handleOverlayPointerCancel = useCallback(() => {
        selectionStartRef.current = null;
        setDrawingBox(null);
        mapRef.current?.dragging.enable();
    }, []);

    React.useEffect(() => {
        if (!isSelectionMode) {
            selectionStartRef.current = null;
            setDrawingBox(null);
            if (mapRef.current) mapRef.current.dragging.enable();
            return;
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            selectionStartRef.current = null;
            flushSync(() => setDrawingBox(null));
            if (mapRef.current) mapRef.current.dragging.enable();
            onSelectionModeChange?.(false);
        };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [isSelectionMode, onSelectionModeChange]);

    const handleLassoPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isLassoMode || !mapRef.current) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const latlng = mapRef.current.containerPointToLatLng(pos);
        isDrawingLassoRef.current = true;
        setDrawingLasso([[latlng.lat, latlng.lng]]);
        mapRef.current.dragging.disable();
    }, [isLassoMode]);

    const handleLassoPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDrawingLassoRef.current || !drawingLasso || !mapRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = L.point(e.clientX - rect.left, e.clientY - rect.top);
        const latlng = mapRef.current.containerPointToLatLng(pos);
        setDrawingLasso([...drawingLasso, [latlng.lat, latlng.lng]]);
    }, [drawingLasso]);

    const handleLassoPointerUp = useCallback(() => {
        if (!isDrawingLassoRef.current || !drawingLasso || drawingLasso.length < 3) {
            isDrawingLassoRef.current = false;
            setDrawingLasso(null);
            if (mapRef.current) mapRef.current.dragging.enable();
            return;
        }

        // Close the polygon by adding the first point at the end
        const closedPolygon = [...drawingLasso, drawingLasso[0]];
        console.log('[Lasso] Polygon completed:', {
            points: closedPolygon.length,
            minLat: Math.min(...closedPolygon.map(p => p[0])),
            maxLat: Math.max(...closedPolygon.map(p => p[0])),
            minLon: Math.min(...closedPolygon.map(p => p[1])),
            maxLon: Math.max(...closedPolygon.map(p => p[1])),
            first: closedPolygon[0],
            sample: closedPolygon.slice(1, 4)
        });
        onSelectionPolygonChange?.(closedPolygon);
        isDrawingLassoRef.current = false;
        setDrawingLasso(null);
        if (mapRef.current) mapRef.current.dragging.enable();
        // Match Area mode: return to Point mode after a completed selection.
        setTimeout(() => onLassoModeChange?.(false), 100);
    }, [drawingLasso, onSelectionPolygonChange, onLassoModeChange]);

    const handleLassoPointerCancel = useCallback(() => {
        isDrawingLassoRef.current = false;
        setDrawingLasso(null);
        if (mapRef.current) mapRef.current.dragging.enable();
    }, []);

    React.useEffect(() => {
        if (!isLassoMode) {
            isDrawingLassoRef.current = false;
            setDrawingLasso(null);
            if (mapRef.current) mapRef.current.dragging.enable();
            return;
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            isDrawingLassoRef.current = false;
            flushSync(() => setDrawingLasso(null));
            if (mapRef.current) mapRef.current.dragging.enable();
        };
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [isLassoMode]);

    const handleMapClick = useCallback((latlng: L.LatLng) => {
        if (isPickingStart) { onStartPick?.(latlng.lat, latlng.lng); return; }
        if (isSelectionMode || isLassoMode || isEraserMode) return;
        onPointAdd({ lat: latlng.lat, lon: latlng.lng });
    }, [onPointAdd, isSelectionMode, isLassoMode, isEraserMode, isPickingStart, onStartPick]);

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

    const buildChevronMarkers = React.useCallback(buildChevronMarkersImpl, []);

    // Base spacing is tuned for zoom 14 (block-level detail). Each level zoomed
    // out doubles the ground distance a given screen distance covers, so a fixed
    // ground spacing reads as denser and denser — scale spacing/dedup-gap to
    // compensate, roughly halving chevron count per level zoomed out.
    const CHEVRON_BASE_ZOOM = 14;
    const chevronDensityScale = Math.min(4, Math.max(1, Math.pow(2, CHEVRON_BASE_ZOOM - zoom)));

    // Chevron markers: one every ~400m (scaled by zoom) along the full generated
    // route, spatially de-duplicated (see buildChevronMarkers) for zigzagging routes.
    const chevronMarkers = React.useMemo(() => {
        if (!route || route.length < 2) return [];
        return buildChevronMarkers(route.map(p => [p[0], p[1]] as [number, number]), chevronDensityScale);
    }, [route, buildChevronMarkers, chevronDensityScale]);



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
                {startPoint && (
                    <Marker
                        position={[startPoint.lat, startPoint.lon]}
                        icon={L.divIcon({
                            className: '',
                            // Hit area (36px) is padded well past the visible glyph (22px) — at
                            // low zoom a click near the icon could otherwise land a block away
                            // from the actual saved coordinate. Anchored dead-center so the
                            // clickable box and the visible emoji line up exactly (the old
                            // combination of iconAnchor + an extra CSS translate offset caused
                            // the two to diverge).
                            html: '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:22px;line-height:22px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))">🏠</div>',
                            iconSize: [36, 36],
                            iconAnchor: [18, 18],
                        })}
                        title={startPoint.label}
                        zIndexOffset={600}
                        eventHandlers={{
                            click: (e: any) => {
                                L.DomEvent.stopPropagation(e);
                                if (isPickingStart) { onStartPick?.(startPoint.lat, startPoint.lon); return; }
                                if (isSelectionMode || isLassoMode || isEraserMode) return;
                                onPointAdd({ lat: startPoint.lat, lon: startPoint.lon });
                            },
                        }}
                    />
                )}
                <GeolocateOnMount />
                <InvalidateSizeOnRoute route={route} />
                <MapRefCapture mapRef={mapRef} onZoomChange={setZoom} />

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

                {/* Currently drawing lasso */}
                {drawingLasso && drawingLasso.length > 0 && (
                    <Polyline
                        positions={drawingLasso as [number, number][]}
                        color="#EC4899"
                        weight={3}
                        opacity={0.9}
                        dashArray="5, 5"
                        interactive={false}
                    />
                )}

                {/* Completed lasso polygons */}
                {selectionPolygons && selectionPolygons.map((polygon, idx) => (
                    <Polyline
                        key={`lasso-${idx}`}
                        positions={polygon as [number, number][]}
                        color="#EC4899"
                        weight={2}
                        opacity={0.7}
                        dashArray="5, 5"
                        interactive={false}
                    />
                ))}

                {/* Strava roads - snapped to OSM geometry */}
                {/* Activities snapped to road network, so overlapping rides follow exact same path */}
                {snappedStravaRoads.map((road, idx) => (
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
                        weight={6}
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
                        weight={6}
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
                            html: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" style="transform:rotate(${m.angle}deg);display:block;filter:drop-shadow(0 0 1px rgba(0,0,0,.5));">
                                <polyline points="5,19 11,5 17,19" stroke="white" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                                <polyline points="5,19 11,5 17,19" stroke="black" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                            </svg>`,
                            iconSize: [22, 22],
                            iconAnchor: [11, 11],
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
                            click: isEraserMode ? undefined : (e) => {
                                if (isPickingStart) { onStartPick?.(e.latlng.lat, e.latlng.lng); return; }
                                onPointAdd({ lat: e.latlng.lat, lon: e.latlng.lng });
                            },
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

                    // Visible dot stays 14px, but the icon (and thus the draggable/clickable
                    // hit area) is padded out to 32px — the 14px target was too small to
                    // reliably grab with a real mouse among dense, overlapping streets.
                    const markerIcon = getPointMarkerIcon(color, point.status === 'pending');

                    return (
                        <Marker
                            key={point.id}
                            position={[point.lat, point.lon]}
                            icon={markerIcon}
                            draggable={true}
                            zIndexOffset={500}
                            title="Drag to move, right-click to delete"
                            eventHandlers={{
                                dragstart: (e: any) => {
                                    onPointMoveStart?.();
                                },
                                dragend: (e: any) => {
                                    const marker = e.target;
                                    const position = marker.getLatLng();
                                    // Defer past this tick — Leaflet's own drag-cleanup (finishDrag)
                                    // is still unwinding here, and a same-tick icon swap (from the
                                    // resulting status: 'pending' re-render) re-enters it on a stale
                                    // internal reference and throws inside leaflet-src.js.
                                    setTimeout(() => {
                                        onPointMove(idx, { lat: position.lat, lon: position.lng });
                                        onPointMoveEnd?.();
                                    }, 0);
                                },
                                contextmenu: (e: any) => {
                                    L.DomEvent.stopPropagation(e);
                                    L.DomEvent.preventDefault(e);
                                    const marker = e.target;
                                    const container = L.DomUtil.create('div', 'waypoint-popup');
                                    const btn = L.DomUtil.create('button', 'waypoint-popup-delete', container);
                                    btn.textContent = 'Delete Waypoint';
                                    btn.onclick = () => {
                                        onPointDelete?.(idx);
                                        marker.closePopup();
                                    };
                                    marker.bindPopup(container, { closeButton: false, className: 'waypoint-context-popup', offset: [0, -6] }).openPopup();
                                },
                            }}
                        />
                    );
                })}

                {/* Start/end markers for area-only mode (no manual waypoints) */}
                {routeStartPoint && (
                    <Marker
                        key="route-start"
                        position={[routeStartPoint.lat, routeStartPoint.lon]}
                        interactive={false}
                        zIndexOffset={500}
                        icon={L.divIcon({
                            className: '',
                            html: '<div style="width:14px;height:14px;background:#10B981;border:2px solid white;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>',
                            iconSize: [14, 14],
                            iconAnchor: [7, 7],
                        })}
                    />
                )}
                {routeEndPoint && (
                    <Marker
                        key="route-end"
                        position={[routeEndPoint.lat, routeEndPoint.lon]}
                        interactive={false}
                        zIndexOffset={500}
                        icon={L.divIcon({
                            className: '',
                            html: '<div style="width:14px;height:14px;background:#EF4444;border:2px solid white;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.3)"></div>',
                            iconSize: [14, 14],
                            iconAnchor: [7, 7],
                        })}
                    />
                )}

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
                {route && route.length > 0 && onRouteHover && (
                    <RouteHoverTracker route={route} onRouteHover={onRouteHover} />
                )}
            </MapContainer>

            {isSelectionMode && (
                <div
                    className="absolute inset-0"
                    style={{ cursor: 'crosshair', zIndex: 999, userSelect: 'none', touchAction: 'none' }}
                    onPointerDown={handleOverlayPointerDown}
                    onPointerMove={handleOverlayPointerMove}
                    onPointerUp={handleOverlayPointerUp}
                    onPointerCancel={handleOverlayPointerCancel}
                    onWheel={handleOverlayWheel}
                />
            )}

            {isLassoMode && (
                <div
                    className="absolute inset-0"
                    style={{ cursor: 'crosshair', zIndex: 999, userSelect: 'none', touchAction: 'none' }}
                    onPointerDown={handleLassoPointerDown}
                    onPointerMove={handleLassoPointerMove}
                    onPointerUp={handleLassoPointerUp}
                    onPointerCancel={handleLassoPointerCancel}
                    onWheel={handleOverlayWheel}
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
                .waypoint-context-popup .leaflet-popup-content-wrapper {
                    padding: 0;
                    border-radius: 6px;
                }
                .waypoint-context-popup .leaflet-popup-content {
                    margin: 0;
                }
                .waypoint-context-popup .leaflet-popup-tip {
                    display: none;
                }
                .waypoint-popup-delete {
                    display: block;
                    padding: 8px 14px;
                    color: #DC2626;
                    font-size: 13px;
                    font-weight: 600;
                    white-space: nowrap;
                    cursor: pointer;
                }
                .waypoint-popup-delete:hover {
                    background: #FEF2F2;
                }
            `}</style>
        </div>
    );
};

export default Map;
