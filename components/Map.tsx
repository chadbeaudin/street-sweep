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

function RecenterMap({ lat, lon }: { lat: number, lon: number }) {
    const map = useMapEvents({});
    useEffect(() => {
        map.setView([lat, lon], map.getZoom());
    }, [lat, lon, map]);
    return null;
}

export default function Map({ route, bbox, onBBoxChange }: MapProps) {
    // Convert GeoJSON [lon, lat] to Leaflet [lat, lon]
    const leafletRoute = route.map(p => [p[1], p[0]] as [number, number]);
    const [center, setCenter] = useState<[number, number]>([40.0150, -105.2705]); // Default Boulder
    const [hasLocation, setHasLocation] = useState(false);

    useEffect(() => {
        if (navigator.geolocation && !hasLocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setCenter([position.coords.latitude, position.coords.longitude]);
                    setHasLocation(true);
                },
                (error) => {
                    console.error("Error getting location", error);
                }
            );
        }
    }, [hasLocation]);

    return (
        <MapContainer
            center={center}
            zoom={14}
            className="absolute inset-0 outline-none"
            style={{ width: '100%', height: '100%' }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {hasLocation && <RecenterMap lat={center[0]} lon={center[1]} />}
            {leafletRoute.length > 0 && (
                <Polyline positions={leafletRoute} color="blue" weight={4} />
            )}
            <MapEvents onBBoxChange={onBBoxChange} />
        </MapContainer>
    );
}
