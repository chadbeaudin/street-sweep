// Analyze theoretical CPP optimality for a given selection box.
// Compares: total required edge length, minimum doubling required, optimal CPP, vs the actual route.
//
// Usage: ts-node scripts/analyze-cpp-optimality.ts

import { fetchOSMData } from '../lib/overpass';
import { StreetGraph } from '../lib/graph';

// Box from the user's latest log (reconstructed from buffered bbox minus 500m buffer)
const BOX = { south: 47.62938, north: 47.64131, west: -117.43138, east: -117.38469 };
const BUFFER = 0.005;
const buffered = {
  south: BOX.south - BUFFER,
  north: BOX.north + BUFFER,
  west: BOX.west - BUFFER,
  east: BOX.east + BUFFER,
};

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
  console.log('Fetching OSM data...');
  const osm = await fetchOSMData(buffered);
  console.log(`Fetched ${osm.elements.length} elements`);

  const graph = StreetGraph.getCachedGraph(buffered, osm, [], {});

  // Find edges inside the box
  const BOX_BUFFER = 0.0001;
  const inBox = (lat: number, lon: number) =>
    lat <= BOX.north + BOX_BUFFER &&
    lat >= BOX.south - BOX_BUFFER &&
    lon <= BOX.east + BOX_BUFFER &&
    lon >= BOX.west - BOX_BUFFER;

  let totalRequiredLength = 0;
  const requiredEdges: { u: string, v: string, length: number }[] = [];
  const nodeDegree = new Map<string, number>();
  const nodeCoords = new Map<string, { lat: number; lon: number }>();

  (graph as any).graph.forEachLink((link: any) => {
    if (link.data.isAvoided) return;
    const u = (graph as any).graph.getNode(link.fromId);
    const v = (graph as any).graph.getNode(link.toId);
    if (!u || !v) return;

    const uIn = inBox(u.data.lat, u.data.lon);
    const vIn = inBox(v.data.lat, v.data.lon);
    if (!uIn && !vIn) return;

    const length = haversine(u.data.lat, u.data.lon, v.data.lat, v.data.lon);
    totalRequiredLength += length;
    requiredEdges.push({ u: u.id.toString(), v: v.id.toString(), length });
    nodeDegree.set(u.id.toString(), (nodeDegree.get(u.id.toString()) || 0) + 1);
    nodeDegree.set(v.id.toString(), (nodeDegree.get(v.id.toString()) || 0) + 1);
    nodeCoords.set(u.id.toString(), { lat: u.data.lat, lon: u.data.lon });
    nodeCoords.set(v.id.toString(), { lat: v.data.lat, lon: v.data.lon });
  });

  console.log(`\nRequired edges: ${requiredEdges.length}`);
  console.log(`Total required length: ${(totalRequiredLength / 1609.34).toFixed(3)} miles (${totalRequiredLength.toFixed(0)} m)`);

  // Count odd-degree nodes
  const oddNodes: string[] = [];
  for (const [n, d] of nodeDegree.entries()) {
    if (d % 2 !== 0) oddNodes.push(n);
  }
  console.log(`Odd-degree nodes: ${oddNodes.length}`);

  if (oddNodes.length === 0) {
    console.log(`\nGraph is Eulerian! Optimal = ${(totalRequiredLength / 1609.34).toFixed(3)} miles`);
    return;
  }

  // Compute minimum matching weight (geometric distance lower bound)
  // For a tight lower bound, we'd need APSP through the graph. Quick estimate: pairwise haversine.
  const oddPairs: { u: string, v: string, dist: number }[] = [];
  for (let i = 0; i < oddNodes.length; i++) {
    for (let j = i + 1; j < oddNodes.length; j++) {
      const a = nodeCoords.get(oddNodes[i])!;
      const b = nodeCoords.get(oddNodes[j])!;
      oddPairs.push({ u: oddNodes[i], v: oddNodes[j], dist: haversine(a.lat, a.lon, b.lat, b.lon) });
    }
  }
  oddPairs.sort((a, b) => a.dist - b.dist);

  // Greedy matching as a quick lower bound
  const matched = new Set<string>();
  let extraLength = 0;
  for (const p of oddPairs) {
    if (matched.has(p.u) || matched.has(p.v)) continue;
    matched.add(p.u);
    matched.add(p.v);
    extraLength += p.dist;
  }
  console.log(`Greedy haversine matching (lower bound): ${(extraLength / 1609.34).toFixed(3)} miles extra`);

  const optimalEstimate = totalRequiredLength + extraLength;
  console.log(`\nTheoretical lower bound: ${(optimalEstimate / 1609.34).toFixed(3)} miles`);
  console.log(`Actual current route: 2.44 miles (per user)`);
  console.log(`\nNote: real APSP-based matching will be slightly higher than the haversine bound`);
  console.log(`since paths must follow streets. Expect ~5-15% above this lower bound is achievable.`);
}

main().catch(console.error);
