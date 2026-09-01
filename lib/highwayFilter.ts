// Highway types considered part of the routable street network. `path`,
// `track`, and `bridleway` are always included — OSM convention doesn't use
// them for sidewalks, so this is how dirt trails, singletrack, forest roads,
// and rail-trails get in.
const BASE_ROUTABLE_HIGHWAYS = new Set([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'unclassified', 'residential', 'living_street', 'motorway_link', 'trunk_link',
    'primary_link', 'secondary_link', 'tertiary_link', 'track', 'cycleway', 'path', 'bridleway',
]);

// `footway` is ambiguous: it covers both standalone park/trail paths (almost
// never tagged with `bicycle`) and sidewalks running alongside a road. The
// `footway=sidewalk`/`crossing` subtag is the reliable signal for "this is a
// sidewalk" — plain `footway` with no subtag is treated as a trail.
const SIDEWALK_SUBTYPES = new Set(['sidewalk', 'crossing']);
const BIKE_FORBIDDEN_TAGS = new Set(['no', 'private']);

// `service` is similarly ambiguous: park maintenance/multi-use paths are
// commonly tagged plain `highway=service` (no subtype) instead of `path` —
// this is how paved/compacted paths inside parks (e.g. High Bridge Park's
// interior network) get in. The `service` subtag is the reliable signal for
// "this is functional property access, not a path" — driveways, alleys, and
// parking aisles stay excluded.
const SERVICE_EXCLUDED_SUBTYPES = new Set(['alley', 'driveway', 'parking_aisle', 'emergency_access']);

export function isRoutableHighway(highway: string | undefined, tags?: Record<string, string>): boolean {
    if (!highway) return false;
    if (highway === 'footway') {
        if (SIDEWALK_SUBTYPES.has(tags?.footway ?? '')) return false;
        if (BIKE_FORBIDDEN_TAGS.has(tags?.bicycle ?? '')) return false;
        return true;
    }
    if (highway === 'service') {
        return !SERVICE_EXCLUDED_SUBTYPES.has(tags?.service ?? '');
    }
    return BASE_ROUTABLE_HIGHWAYS.has(highway);
}
