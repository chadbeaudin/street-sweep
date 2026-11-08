// Raster basemaps that only need a tile URL to swap in (#175), for evaluating
// alternatives to the openstreetmap.org tiles. Several are free for
// non-commercial or development use only; picking one for production is a
// separate decision.

export interface MapStyle {
    id: string;
    label: string;
    url: string;
    attribution: string;
    maxNativeZoom: number;
    subdomains?: string;
    // Light styles are inverted in dark mode; already-dark styles aren't.
    invertInDark: boolean;
}

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const MAP_STYLES: MapStyle[] = [
    { id: 'osm', label: 'OSM Standard', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM, maxNativeZoom: 19, invertInDark: true },
    { id: 'cyclosm', label: 'CyclOSM (cycling)', url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', attribution: `<a href="https://www.cyclosm.org">CyclOSM</a> | ${OSM}`, maxNativeZoom: 20, subdomains: 'abc', invertInDark: true },
    { id: 'usgs-topo', label: 'USGS Topo (US only)', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>', maxNativeZoom: 16, invertInDark: true },
];

// Map zoom stays capped where it has always been; styles with fewer native levels upscale their last one.
export const MAP_MAX_ZOOM = 18;

export function tileLayerProps(style: MapStyle) {
    return {
        url: style.url,
        attribution: style.attribution,
        subdomains: style.subdomains ?? 'abc',
        maxNativeZoom: Math.min(style.maxNativeZoom, MAP_MAX_ZOOM),
        maxZoom: MAP_MAX_ZOOM,
        className: style.invertInDark ? 'map-tiles-invert-dark' : '',
    };
}

export const DEFAULT_MAP_STYLE_ID = 'osm';
export const MAP_STYLE_KEY = 'map_style';

export function resolveMapStyle(savedId: string | null): MapStyle {
    return MAP_STYLES.find(s => s.id === savedId) ?? MAP_STYLES.find(s => s.id === DEFAULT_MAP_STYLE_ID)!;
}
