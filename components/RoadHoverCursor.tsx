'use client';

import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type L from 'leaflet';
import { isNearRoad, type IndexedRoad } from '@/lib/roadTiles';

// Half the old 15px-wide invisible hitbox lines, so the clickable band feels the same.
const ROAD_HOVER_TOLERANCE_PX = 7.5;

// Shows the pointer cursor over a street. This used to come from an invisible,
// interactive polyline per street in view: thousands of Leaflet layers built
// every time roads loaded (a ~100-350ms freeze) and hit-tested on every mouse
// move (#181). Clicks never needed them; the map's own click handler adds the point.
export function RoadHoverCursor({ index, enabled }: { index: IndexedRoad[]; enabled: boolean }) {
    const map = useMap();
    useEffect(() => {
        const container = map.getContainer();
        if (!enabled) { container.classList.remove('over-road'); return; }
        let frame = 0;
        let last: L.LeafletMouseEvent | null = null;
        const check = () => {
            frame = 0;
            if (!last) return;
            const cursor = last.containerPoint;
            const corner = (dx: number, dy: number) => map.containerPointToLatLng([cursor.x + dx, cursor.y + dy]);
            const nw = corner(-ROAD_HOVER_TOLERANCE_PX, -ROAD_HOVER_TOLERANCE_PX);
            const se = corner(ROAD_HOVER_TOLERANCE_PX, ROAD_HOVER_TOLERANCE_PX);
            const near = isNearRoad(
                index,
                cursor,
                { south: se.lat, north: nw.lat, west: nw.lng, east: se.lng },
                ([lat, lon]) => map.latLngToContainerPoint([lat, lon]),
                ROAD_HOVER_TOLERANCE_PX,
            );
            container.classList.toggle('over-road', near);
        };
        const onMove = (e: L.LeafletMouseEvent) => {
            last = e;
            if (!frame) frame = requestAnimationFrame(check);
        };
        const onOut = () => { last = null; container.classList.remove('over-road'); };
        map.on('mousemove', onMove);
        map.on('mouseout', onOut);
        return () => {
            map.off('mousemove', onMove);
            map.off('mouseout', onOut);
            if (frame) cancelAnimationFrame(frame);
            container.classList.remove('over-road');
        };
    }, [map, index, enabled]);
    return null;
}
