'use client';

import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, CircleMarker } from 'react-leaflet';
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

const Map: React.FC<MapProps> = ({ bbox, onBBoxChange, route, hoveredPoint }) => {
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
                        color="#6366F1"
                        weight={5}
                        opacity={0.7}
                    />
                )}

                {hoveredPoint && (
                    <CircleMarker
                        center={[hoveredPoint.lat, hoveredPoint.lon]}
                        radius={10}
                        pathOptions={{
                            fillColor: '#F59E0B', // Bright yellow-orange
                            fillOpacity: 1,
                            color: 'white',
                            weight: 3,
                            className: 'animate-pulse'
                        }}
                    />
                )}
            </MapContainer>
        </div>
    );
};

export default Map;
