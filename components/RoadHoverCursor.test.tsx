/**
 * @jest-environment jsdom
 */

import { act, render } from '@testing-library/react';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { RoadHoverCursor } from './RoadHoverCursor';
import { indexRoadBounds } from '@/lib/roadTiles';

// jsdom has no layout; give the map a real size so pixel <-> lat/lon projection works.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
    window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
    window.cancelAnimationFrame = (id: number) => clearTimeout(id);
});

// A street running east-west through the map's center.
const CENTER: [number, number] = [47.6588, -117.426];
const street: [number, number][] = [[CENTER[0], CENTER[1] - 0.01], [CENTER[0], CENTER[1] + 0.01]];

let map: L.Map;
function Capture() { map = useMap(); return null; }

const renderCursor = (enabled = true) => render(
    <MapContainer center={CENTER} zoom={15} className="point-mode">
        <Capture />
        <RoadHoverCursor index={indexRoadBounds([street])} enabled={enabled} />
    </MapContainer>
);

async function hover(dy: number) {
    const containerPoint = map.latLngToContainerPoint(CENTER).add([0, dy]);
    await act(async () => {
        map.fire('mousemove', { containerPoint, latlng: map.containerPointToLatLng(containerPoint) });
        await new Promise(r => setTimeout(r, 5));
    });
}
const overRoad = () => map.getContainer().classList.contains('over-road');

describe('RoadHoverCursor (#181)', () => {
    it('marks the map while the cursor is over a street, and clears it when it moves off', async () => {
        renderCursor();
        await hover(0);
        expect(overRoad()).toBe(true);
        await hover(5);
        expect(overRoad()).toBe(true);
        await hover(30);
        expect(overRoad()).toBe(false);
    });

    it('clears when the cursor leaves the map', async () => {
        renderCursor();
        await hover(0);
        act(() => { map.fire('mouseout'); });
        expect(overRoad()).toBe(false);
    });

    it('does nothing in modes where streets are not clickable', async () => {
        renderCursor(false);
        await hover(0);
        expect(overRoad()).toBe(false);
    });

    it('adds no map layers, unlike the per-street hitboxes it replaces', () => {
        renderCursor();
        let layers = 0;
        map.eachLayer(() => { layers++; });
        expect(layers).toBe(0);
    });
});
