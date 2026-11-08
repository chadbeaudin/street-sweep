import fs from 'fs';
import { MAP_STYLES, MAP_MAX_ZOOM, DEFAULT_MAP_STYLE_ID, resolveMapStyle, tileLayerProps } from './mapStyles';

const byId = (id: string) => MAP_STYLES.find(s => s.id === id)!;

describe('MAP_STYLES', () => {
    it('has unique ids and the current OSM tiles as the default', () => {
        expect(new Set(MAP_STYLES.map(s => s.id)).size).toBe(MAP_STYLES.length);
        expect(byId(DEFAULT_MAP_STYLE_ID).url).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    });

    it.each(MAP_STYLES.map(s => [s.id, s]))('%s is a usable https tile template with attribution', (_, style) => {
        expect(style.url).toMatch(/^https:\/\//);
        for (const token of ['{z}', '{x}', '{y}']) expect(style.url).toContain(token);
        expect(style.attribution.length).toBeGreaterThan(10);
        if (style.url.includes('{s}')) expect(tileLayerProps(style).subdomains.length).toBeGreaterThan(0);
    });

    it('inverts every remaining style in dark mode, since none is dark already', () => {
        expect(MAP_STYLES.every(s => s.invertInDark)).toBe(true);
    });
});

describe('resolveMapStyle', () => {
    it('uses a saved style', () => {
        expect(resolveMapStyle('cyclosm').id).toBe('cyclosm');
    });

    it('falls back to the default for a missing or removed style', () => {
        expect(resolveMapStyle(null).id).toBe(DEFAULT_MAP_STYLE_ID);
        expect(resolveMapStyle('esri-imagery').id).toBe(DEFAULT_MAP_STYLE_ID);
        expect(resolveMapStyle('stadia-outdoors').id).toBe(DEFAULT_MAP_STYLE_ID);
        expect(resolveMapStyle('carto-voyager').id).toBe(DEFAULT_MAP_STYLE_ID);
    });

    it('offers exactly the evaluated styles', () => {
        expect(MAP_STYLES.map(s => s.id)).toEqual(['osm', 'cyclosm', 'usgs-topo']);
    });
});

describe('tileLayerProps', () => {
    it('keeps the map zoom cap and upscales styles with fewer native levels', () => {
        expect(tileLayerProps(byId('usgs-topo'))).toMatchObject({ maxNativeZoom: 16, maxZoom: MAP_MAX_ZOOM });
        expect(tileLayerProps(byId('cyclosm'))).toMatchObject({ maxNativeZoom: MAP_MAX_ZOOM, maxZoom: MAP_MAX_ZOOM });
    });

    it('marks only invertible styles for the dark-mode filter', () => {
        expect(tileLayerProps(byId('osm')).className).toBe('map-tiles-invert-dark');
        expect(tileLayerProps({ ...byId('osm'), invertInDark: false }).className).toBe('');
    });

    it('matches the dark-mode filter rule in the stylesheet', () => {
        const css = fs.readFileSync('app/globals.css', 'utf8');
        expect(css).toMatch(/\.dark \.map-tiles-invert-dark\s*\{[^}]*filter: invert\(1\)/);
        expect(css).not.toMatch(/\.leaflet-tile-pane\s*\{[^}]*filter/);
    });
});
