'use client';

import React, { useEffect } from 'react';
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
}

function MapEvents({ onBBoxChange }: { onBBoxChange: (bbox: any) => void }) {
    const map = useMapEvents({
        moveend: () => {
            const bounds = map.getBounds();
            onBBoxChange({
                south: bounds.getSouth(),
                west: bounds.getWest(),
                north: bounds.getNorth(),
                east: bounds.getEast(),
            });
        },
    });
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

const Map: React.FC<MapProps> = ({ bbox, onBBoxChange, route, hoveredPoint, stravaRoads }) => {
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
                <MapEvents onBBoxChange={onBBoxChange} />
                <RecenterMap route={route} />

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
            </MapContainer>

            <style jsx global>{`
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.3); opacity: 0.8; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default Map;
