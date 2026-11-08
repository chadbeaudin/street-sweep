/**
 * @jest-environment jsdom
 */

// Why the ridden-roads lines take their color through pathOptions (#177):
// react-leaflet applies a top-level color prop only when a line is created,
// so switching map styles would leave existing lines in the old color.
import { render } from '@testing-library/react';
import { MapContainer, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { riddenPathOptionsFor } from './mapStyles';

const positions: [number, number][] = [[47.65, -117.42], [47.66, -117.41]];
const strokeOf = (container: HTMLElement) => container.querySelector('path.leaflet-interactive, path')?.getAttribute('stroke');

function TestMap({ children }: { children: React.ReactNode }) {
    return (
        <MapContainer center={[47.655, -117.415]} zoom={14} renderer={L.svg()} style={{ width: 400, height: 400 }}>
            {children}
        </MapContainer>
    );
}

describe('ridden overlay color on a style change', () => {
    it('recolors existing lines when pathOptions change', () => {
        const { container, rerender } = render(<TestMap><Polyline positions={positions} pathOptions={riddenPathOptionsFor('#1D4ED8').matched} /></TestMap>);
        expect(strokeOf(container)).toBe('#1D4ED8');
        rerender(<TestMap><Polyline positions={positions} pathOptions={riddenPathOptionsFor('#EA580C').matched} /></TestMap>);
        expect(strokeOf(container)).toBe('#EA580C');
    });

    it('would not recolor through a plain color prop', () => {
        const { container, rerender } = render(<TestMap><Polyline positions={positions} color="#1D4ED8" /></TestMap>);
        rerender(<TestMap><Polyline positions={positions} color="#EA580C" /></TestMap>);
        expect(strokeOf(container)).toBe('#1D4ED8');
    });
});
