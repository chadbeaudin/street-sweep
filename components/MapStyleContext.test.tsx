/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapStyleProvider, useMapStyle } from './MapStyleContext';
import { MapStylePicker } from './MapStylePicker';
import { MAP_STYLE_KEY } from '@/lib/mapStyles';

function CurrentStyle() {
    const { style } = useMapStyle();
    return <output data-testid="current">{style.url}</output>;
}

const renderPicker = () => render(<MapStyleProvider><MapStylePicker /><CurrentStyle /></MapStyleProvider>);

beforeEach(() => localStorage.clear());

describe('MapStylePicker', () => {
    it('starts on OSM Standard and lists the other styles', () => {
        renderPicker();
        expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('osm');
        expect(screen.getByRole('option', { name: 'CyclOSM (cycling)' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'USGS Topo (US only)' })).toBeInTheDocument();
    });

    it('switches the map tiles and remembers the choice', () => {
        renderPicker();
        fireEvent.change(screen.getByRole('combobox', { name: 'Map style' }), { target: { value: 'cyclosm' } });
        expect(screen.getByTestId('current')).toHaveTextContent('tile-cyclosm.openstreetmap.fr');
        expect(localStorage.getItem(MAP_STYLE_KEY)).toBe('cyclosm');
    });

    it('restores a saved style and ignores an unknown one', () => {
        localStorage.setItem(MAP_STYLE_KEY, 'usgs-topo');
        const { unmount } = renderPicker();
        expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('usgs-topo');
        unmount();

        localStorage.setItem(MAP_STYLE_KEY, 'retired-style');
        renderPicker();
        expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('osm');
    });
});
