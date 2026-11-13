'use client';

import React, { useCallback, useRef, useState } from 'react';
import L from 'leaflet';
import { eraseFromPolylines } from '@/lib/avoidEraser';

type Roads = [number, number][][];

export const AVOID_ERASER_RADIUS_PX = 14;

interface Props {
    mapRef: React.RefObject<L.Map | null>;
    roads: Roads;
    onPreview: (roads: Roads | null) => void;
    onCommit: (roads: Roads) => void;
    onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
}

// Drag-to-erase brush for avoided roads (#204). A stroke erases into a preview
// and is committed once on pointer-up, so dragging doesn't save to the account per move.
export function AvoidEraserOverlay({ mapRef, roads, onPreview, onCommit, onWheel }: Props) {
    const strokeRef = useRef<Roads | null>(null);
    const lastPosRef = useRef<L.Point | null>(null);
    const [cursor, setCursor] = useState<L.Point | null>(null);

    const eraseAlong = useCallback((to: L.Point) => {
        const map = mapRef.current;
        if (!map || !strokeRef.current) return;
        // Step along the swept path so a fast drag doesn't skip between pointer samples.
        const from = lastPosRef.current ?? to;
        const steps = Math.max(1, Math.ceil(from.distanceTo(to) / (AVOID_ERASER_RADIUS_PX / 2)));
        let next = strokeRef.current;
        for (let i = 1; i <= steps; i++) {
            const pos = from.add(to.subtract(from).multiplyBy(i / steps));
            const center = map.containerPointToLatLng(pos);
            const radius = center.distanceTo(map.containerPointToLatLng(pos.add([AVOID_ERASER_RADIUS_PX, 0])));
            next = eraseFromPolylines(next, [center.lat, center.lng], radius);
        }
        lastPosRef.current = to;
        if (next !== strokeRef.current) {
            strokeRef.current = next;
            onPreview(next);
        }
    }, [mapRef, onPreview]);

    const overlayPoint = (e: React.PointerEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        return L.point(e.clientX - rect.left, e.clientY - rect.top);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        strokeRef.current = roads;
        lastPosRef.current = null;
        eraseAlong(overlayPoint(e));
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const pos = overlayPoint(e);
        setCursor(pos);
        eraseAlong(pos);
    };

    const handlePointerUp = () => {
        const stroke = strokeRef.current;
        strokeRef.current = null;
        if (stroke && stroke !== roads) onCommit(stroke);
        onPreview(null);
    };

    const handlePointerCancel = () => {
        strokeRef.current = null;
        onPreview(null);
    };

    return (
        <div
            data-testid="avoid-eraser-overlay"
            className="absolute inset-0"
            style={{ cursor: 'none', zIndex: 999, userSelect: 'none', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={() => setCursor(null)}
            onWheel={onWheel}
        >
            {cursor && (
                <div
                    className="absolute rounded-full border-2 border-red-600 bg-white/40 pointer-events-none"
                    style={{
                        left: cursor.x - AVOID_ERASER_RADIUS_PX,
                        top: cursor.y - AVOID_ERASER_RADIUS_PX,
                        width: AVOID_ERASER_RADIUS_PX * 2,
                        height: AVOID_ERASER_RADIUS_PX * 2,
                    }}
                />
            )}
        </div>
    );
}
