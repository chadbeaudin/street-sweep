'use client';

import React, { useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, Marker } from 'react-leaflet';
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
        map.on('click', (e) => onMapClick(e.latlng));

        return () => {
            map.off('moveend', handleMove);
            map.off('click');
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

const Map: React.FC<MapProps> = ({ bbox, onBBoxChange, route, hoveredPoint, stravaRoads, selectedPoints, onPointAdd, onPointMove, onPointMoveStart, onPointMoveEnd, manualRoute, allRoads }) => {
    const handleMapClick = useCallback((latlng: L.LatLng) => {
        onPointAdd({ lat: latlng.lat, lon: latlng.lng });
    }, [onPointAdd]);

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


                {/* Manual route from road-snapped coordinates */}
                {flatManualRoute.length > 1 && (
                    <Polyline
                        positions={flatManualRoute.map(p => [p[1], p[0]])}
                        color="#6366F1" // indigo-500
                        weight={3}
                        dashArray="5, 8"
                        opacity={0.6}
                    />
                )}

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
                            bubblingMouseEvents={false}
                            eventHandlers={{
                                dragstart: (e) => {
                                    L.DomEvent.stopPropagation(e);
                                    onPointMoveStart?.();
                                },
                                dragend: (e) => {
                                    L.DomEvent.stopPropagation(e as any);
                                    const marker = e.target;
                                    const position = marker.getLatLng();
                                    onPointMove(idx, { lat: position.lat, lon: position.lng });
                                    onPointMoveEnd?.();
                                },
                                click: (e) => {
                                    L.DomEvent.stopPropagation(e);
                                },
                                mousedown: (e) => {
                                    L.DomEvent.stopPropagation(e);
                                },
                            }}
                        />
                    );
                })}

                {route && route.length > 0 && (
                    <Polyline
                        positions={route.map(p => [p[1], p[0]] as [number, number])}
                        color="#B4491E" // Dark Burnt Orange
                        weight={5}
                        opacity={0.8}
                    />
                )}

                {stravaRoads && stravaRoads.map((road, idx) => (
                    <Polyline
                        key={`strava-${idx}`}
                        positions={road as [number, number][]}
                        color="#3B82F6" // Standard Blue
                        weight={2}
                        opacity={0.8} // Higher opacity reduces the "stacking" heatmap effect
                    />
                ))}

                <HoverMarker point={hoveredPoint} />

                {/* Invisible interactive layer for cursor and snapping - LAST to ensure hover priority */}
                {allRoads && allRoads.map((road, idx) => (
                    <Polyline
                        key={`road-hitbox-${idx}`}
                        positions={road as [number, number][]}
                        pathOptions={{
                            color: '#000',
                            weight: 20,
                            opacity: 0.0001,
                            interactive: true
                        }}
                        eventHandlers={{
                            click: (e) => onPointAdd({ lat: e.latlng.lat, lon: e.latlng.lng }),
                        }}
                    />
                ))}
            </MapContainer>

            <style jsx global>{`
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.3); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .leaflet-container {
                    cursor: grab;
                }
                .leaflet-interactive {
                    cursor: crosshair !important;
                }
            `}</style>
        </div>
    );
};

export default Map;
