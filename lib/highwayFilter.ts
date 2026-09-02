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

// `service` is mostly NOT a trail signal — plain `highway=service` with no
// subtype is overwhelmingly parking-lot loops, private complex access roads,
// and covered/garage circulation (confirmed by querying real OSM data: a
// residential/commercial area returned dozens of plain-service ways, nearly
// all parking-lot or driveway-adjacent, versus the rare legitimate park
// path). `service=drive-through`, `driveway`, `alley`, `parking_aisle`, and
// `emergency_access` are always excluded outright. A plain/unsubtyped service
// way is only included when it has an explicit unpaved/trail-like surface —
// this is how a park's compacted maintenance path (e.g. High Bridge Park's
// interior network) still gets in, without opening the door to asphalt
// parking-lot circulation or building drive-throughs.
const SERVICE_EXCLUDED_SUBTYPES = new Set(['alley', 'driveway', 'parking_aisle', 'emergency_access', 'drive-through']);
const TRAIL_LIKE_SURFACES = new Set(['unpaved', 'compacted', 'gravel', 'fine_gravel', 'dirt', 'ground', 'grass', 'earth', 'woodchips', 'pebblestone']);

export function isRoutableHighway(highway: string | undefined, tags?: Record<string, string>): boolean {
    if (!highway) return false;
    if (highway === 'footway') {
        if (SIDEWALK_SUBTYPES.has(tags?.footway ?? '')) return false;
        if (BIKE_FORBIDDEN_TAGS.has(tags?.bicycle ?? '')) return false;
        return true;
    }
    if (highway === 'service') {
        if (SERVICE_EXCLUDED_SUBTYPES.has(tags?.service ?? '')) return false;
        return TRAIL_LIKE_SURFACES.has(tags?.surface ?? '');
    }
    return BASE_ROUTABLE_HIGHWAYS.has(highway);
}
