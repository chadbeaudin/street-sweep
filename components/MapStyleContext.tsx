'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { MAP_STYLE_KEY, resolveMapStyle, type MapStyle } from '@/lib/mapStyles';

const MapStyleContext = createContext<{ style: MapStyle; setStyleId: (id: string) => void }>({
    style: resolveMapStyle(null),
    setStyleId: () => {},
});

export function MapStyleProvider({ children }: { children: React.ReactNode }) {
    const [style, setStyle] = useState<MapStyle>(() => resolveMapStyle(null));

    useEffect(() => {
        let saved: string | null = null;
        try { saved = localStorage.getItem(MAP_STYLE_KEY); } catch { /* ignore */ }
        setStyle(resolveMapStyle(saved));
    }, []);

    const setStyleId = useCallback((id: string) => {
        const next = resolveMapStyle(id);
        setStyle(next);
        try { localStorage.setItem(MAP_STYLE_KEY, next.id); } catch { /* ignore */ }
    }, []);

    return <MapStyleContext.Provider value={{ style, setStyleId }}>{children}</MapStyleContext.Provider>;
}

export const useMapStyle = () => useContext(MapStyleContext);
