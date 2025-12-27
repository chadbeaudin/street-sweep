'use client';

import React, { useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, Marker, Rectangle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

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
    route: [number, number, number?][] | null;
    hoveredPoint: { lat: number; lon: number } | null;
    stravaRoads: [number, number][][] | null;
    selectedPoints: { lat: number; lon: number; id: string }[];
    onPointAdd: (point: { lat: number; lon: number }) => void;
    onPointMove: (idx: number, latlng: { lat: number; lon: number }) => void;
    onPointMoveStart?: () => void;
    onPointMoveEnd?: () => void;
    manualRoute: [number, number][][];
    allRoads: [number, number][][];
    isSelectionMode?: boolean;
    selectionBox: { north: number; south: number; east: number; west: number } | null;
    onSelectionChange: (box: { north: number; south: number; east: number; west: number } | null) => void;
    onSelectionModeChange?: (isSelectionMode: boolean) => void;
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

        map.on('moveend', handleMove);
        // Removed global click handler - points now only drop on interactive roads

        return () => {
            map.off('moveend', handleMove);
        };
    }, [map, onBBoxChange, onMapClick]);

    return null;
}

function RecenterMap({ route }: { route: [number, number, number?][] | null }) {
    const map = useMap();
    useEffect(() => {
        if (route && route.length > 0) {
            const bounds = L.latLngBounds(route.map(p => [p[1], p[0]]));
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }, [route, map]);
    return null;
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
    isSelectionMode: boolean;
    onSelectionChange: (box: { north: number; south: number; east: number; west: number } | null) => void;
    onSelectionModeChange?: (isSelectionMode: boolean) => void;
}> = ({ isSelectionMode, onSelectionChange, onSelectionModeChange }) => {
    const [startPos, setStartPos] = React.useState<L.LatLng | null>(null);
    const map = useMap();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (startPos) {
                    setStartPos(null);
                    onSelectionChange(null);
                    map.dragging.enable();
                } else {
                    // Even if not dragging, let's clear the selection if it exists
                    onSelectionChange(null);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [startPos, map, onSelectionChange]);

    useMapEvents({
        mousedown: (e) => {
            if (!isSelectionMode) return;
            // Prevent dragging the map while selecting
            map.dragging.disable();
            setStartPos(e.latlng);
        },
        mousemove: (e) => {
            if (!isSelectionMode || !startPos) return;
            onSelectionChange({
                north: Math.max(startPos.lat, e.latlng.lat),
                south: Math.min(startPos.lat, e.latlng.lat),
                east: Math.max(startPos.lng, e.latlng.lng),
                west: Math.min(startPos.lng, e.latlng.lng)
            });
        },
        mouseup: (e) => {
            if (!isSelectionMode) return;
            map.dragging.enable();
            setStartPos(null);
            // Delay reverting to point mode to swallow the subsequent click event
            setTimeout(() => {
                onSelectionModeChange?.(false);
            }, 100);
        }
    });

    return null;
};

const Map: React.FC<MapProps> = ({ bbox, onBBoxChange, route, hoveredPoint, stravaRoads, selectedPoints, onPointAdd, onPointMove, onPointMoveStart, onPointMoveEnd, manualRoute, allRoads, isSelectionMode = false, selectionBox, onSelectionChange, onSelectionModeChange }) => {
    const handleMapClick = useCallback((latlng: L.LatLng) => {
        if (isSelectionMode) return;
        onPointAdd({ lat: latlng.lat, lon: latlng.lng });
    }, [onPointAdd, isSelectionMode]);

    const flatManualRoute = React.useMemo(() => {
        return manualRoute.reduce((acc, seg, i) => {
            if (i === 0) return seg;
            const lastPoint = acc[acc.length - 1];
            const firstPoint = seg[0];
            if (lastPoint && firstPoint && lastPoint[0] === firstPoint[0] && lastPoint[1] === firstPoint[1]) {
                return [...acc, ...seg.slice(1)];
            }
            return [...acc, ...seg];
        }, [] as [number, number][]);
    }, [manualRoute]);

    return (
        <div className="flex-1 relative min-h-0">
            <MapContainer
                center={[39.02, -104.7]}
                zoom={13}
                className="absolute inset-0"
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapEvents onBBoxChange={onBBoxChange} onMapClick={handleMapClick} />
                <RecenterMap route={route} />

                {/* Selection Box Drawing Tool */}
                <SelectionTool
                    isSelectionMode={isSelectionMode}
                    onSelectionChange={onSelectionChange}
                    onSelectionModeChange={onSelectionModeChange}
                />

                {/* Visible Selection Rectangle */}
                {selectionBox && (
                    <Rectangle
                        bounds={[
                            [selectionBox.south, selectionBox.west],
                            [selectionBox.north, selectionBox.east]
                        ]}
                        pathOptions={{
                            color: '#F59E0B',
                            weight: 2,
                            fillColor: '#F59E0B',
                            fillOpacity: 0.2,
                            dashArray: '5, 5'
                        }}
                    />
                )}

                {/* Strava roads - visual background */}
                {/* Visual styling: High opacity to look like solid coverage, not heatmap */}
                {stravaRoads && stravaRoads.map((road, idx) => (
                    <Polyline
                        key={`strava-${idx}`}
                        positions={road as [number, number][]}
                        color="#3B82F6"
                        weight={2}
                        opacity={0.8}
                        interactive={false}
                    />
                ))}

                {/* Manual route from road-snapped coordinates */}
                {flatManualRoute.length > 1 && (
                    <Polyline
                        positions={flatManualRoute.map(p => [p[1], p[0]])}
                        color="#6366F1"
                        weight={3}
                        dashArray="5, 8"
                        opacity={0.6}
                        interactive={false}
                    />
                )}

                {/* Generated route */}
                {route && route.length > 0 && (
                    <Polyline
                        positions={route.map(p => [p[1], p[0]] as [number, number])}
                        color="#B4491E"
                        weight={5}
                        opacity={0.8}
                        interactive={false}
                    />
                )}

                {/* Invisible interactive layer for cursor and snapping - Rendered AFTER visual lines to be on top of them */}
                {allRoads && !isSelectionMode && allRoads.map((road, idx) => (
                    <Polyline
                        key={`road-hitbox-${idx}`}
                        positions={road as [number, number][]}
                        pathOptions={{
                            color: '#3B82F6',
                            weight: 15,
                            opacity: 0, // Totally invisible, but interactive
                            interactive: true,
                            bubblingMouseEvents: true,
                            className: 'road-hitbox'
                        }}
                        eventHandlers={{
                            click: (e) => onPointAdd({ lat: e.latlng.lat, lon: e.latlng.lng }),
                        }}
                    />
                ))}

                {/* Markers for selected points */}
                {selectedPoints.map((point, idx) => {
                    const isFirst = idx === 0;
                    const isLast = idx === selectedPoints.length - 1;
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

                <HoverMarker point={hoveredPoint} />
            </MapContainer>

            <style jsx global>{`
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.3); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .leaflet-container {
                    cursor: grab !important;
                }
                /* Use specific class for roads to avoid overriding markers */
                .leaflet-container .road-hitbox {
                    cursor: crosshair !important;
                    pointer-events: auto !important;
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
