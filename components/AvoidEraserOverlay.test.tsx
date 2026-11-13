/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { AvoidEraserOverlay } from './AvoidEraserOverlay';

// jsdom has no layout; give the map a real size so pixel <-> lat/lon projection works.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
    // jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX/clientY.
    if (!window.PointerEvent) {
        (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {} as typeof MouseEvent;
    }
});

// An avoided road running east-west through the map's center.
const CENTER: [number, number] = [47.6588, -117.426];
const road: [number, number][] = [[CENTER[0], CENTER[1] - 0.01], [CENTER[0], CENTER[1] + 0.01]];

const mapRef: { current: L.Map | null } = { current: null };
function Capture() { mapRef.current = useMap(); return null; }

function setup() {
    const onPreview = jest.fn();
    const onCommit = jest.fn();
    render(
        <>
            <MapContainer center={CENTER} zoom={15}>
                <Capture />
            </MapContainer>
            <AvoidEraserOverlay mapRef={mapRef} roads={[road]} onPreview={onPreview} onCommit={onCommit} />
        </>
    );
    return { onPreview, onCommit, overlay: screen.getByTestId('avoid-eraser-overlay') };
}

const pixelOf = (latlng: [number, number]) => mapRef.current!.latLngToContainerPoint(latlng);

describe('AvoidEraserOverlay (#204)', () => {
    it('erases the dragged-over part of a road and commits once on release', () => {
        const { onPreview, onCommit, overlay } = setup();
        const p = pixelOf(CENTER);

        act(() => {
            fireEvent.pointerDown(overlay, { clientX: p.x, clientY: p.y, pointerId: 1 });
            fireEvent.pointerMove(overlay, { clientX: p.x + 40, clientY: p.y, pointerId: 1 });
        });
        expect(onCommit).not.toHaveBeenCalled();
        expect(onPreview).toHaveBeenCalled();

        act(() => { fireEvent.pointerUp(overlay, { clientX: p.x + 40, clientY: p.y, pointerId: 1 }); });

        expect(onCommit).toHaveBeenCalledTimes(1);
        const [west, east] = onCommit.mock.calls[0][0] as [number, number][][];
        expect(west[0]).toEqual(road[0]);
        expect(east[1]).toEqual(road[1]);
        // The gap spans the whole drag, not just the two sampled pointer positions.
        const gapStartPx = pixelOf(west[1]).x;
        const gapEndPx = pixelOf(east[0]).x;
        expect(gapStartPx).toBeCloseTo(p.x - 14, 0);
        expect(gapEndPx).toBeCloseTo(p.x + 40 + 14, 0);
        expect(onPreview).toHaveBeenLastCalledWith(null);
    });

    it('does not commit when the stroke misses every road', () => {
        const { onCommit, overlay } = setup();
        const p = pixelOf(CENTER);

        act(() => {
            fireEvent.pointerDown(overlay, { clientX: p.x, clientY: p.y + 100, pointerId: 1 });
            fireEvent.pointerUp(overlay, { clientX: p.x, clientY: p.y + 100, pointerId: 1 });
        });

        expect(onCommit).not.toHaveBeenCalled();
    });

    it('does not erase on hover without a pressed pointer', () => {
        const { onPreview, overlay } = setup();
        const p = pixelOf(CENTER);

        act(() => { fireEvent.pointerMove(overlay, { clientX: p.x, clientY: p.y, pointerId: 1 }); });

        expect(onPreview).not.toHaveBeenCalled();
    });
});
