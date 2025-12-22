'use client';

import { MapContainer, TileLayer, Polyline, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import L from 'leaflet';

// Fix Leaflet icon issue in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapProps {
    route: [number, number][]; // [lon, lat] for GeoJSON usually, but Leaflet wants [lat, lon]
    // The API returns GeoJSON coordinates [lon, lat]. Leaflet Polyline needs [lat, lon].
    bbox?: { north: number, south: number, east: number, west: number };
    onBBoxChange?: (bbox: { north: number, south: number, east: number, west: number }) => void;
}

function MapEvents({ onBBoxChange }: { onBBoxChange?: (bbox: any) => void }) {
    const map = useMapEvents({
        moveend: () => {
            if (onBBoxChange) {
                const bounds = map.getBounds();
                onBBoxChange({
                    north: bounds.getNorth(),
                    south: bounds.getSouth(),
                    east: bounds.getEast(),
                    west: bounds.getWest()
                });
            }
        }
    });
    return null;
}

export default function Map({ route, bbox, onBBoxChange }: MapProps) {
    // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
    const leafletRoute = route.map(p => [p[1], p[0]] as [number, number]);

    return (
        <MapContainer
            center={[40.0150, -105.2705]} // Boulder, CO default
            zoom={14}
            className="h-full w-full absolute inset-0 z-0"
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {leafletRoute.length > 0 && (
                <Polyline positions={leafletRoute} color="blue" weight={4} />
            )}
            <MapEvents onBBoxChange={onBBoxChange} />
        </MapContainer>
    );
}
