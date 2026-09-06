import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// Automatically asks the browser for geolocation, and if granted, flies the map to the
// user's actual current position. Geolocation always takes priority over any saved
// persistent start point (#30) -- a stale saved address (e.g. one from before a move)
// should never be what the user sees. If geolocation is denied or unavailable, falls
// back to the saved start point (if any) instead of leaving the map on its placeholder view.
export function useGeolocateOnMount(fallback?: { lat: number; lon: number } | null) {
    const map = useMap();
    useEffect(() => {
        function handleError() {
            if (fallback) {
                map.setView([fallback.lat, fallback.lon], 14);
            }
        }
        map.on('locationerror', handleError);
        map.locate({ setView: true, maxZoom: 14 });
        return () => { map.off('locationerror', handleError); };
    }, [map, fallback]);
}
