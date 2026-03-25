import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

export function useGeolocateOnMount() {
    const map = useMap();
    useEffect(() => {
        // Automatically ask the browser for geolocation, and if granted, flies the map to the user.
        map.locate({ setView: true, maxZoom: 14 });
    }, [map]);
}
