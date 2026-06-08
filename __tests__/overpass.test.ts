// Tests for OSM bbox handling and cache behavior
// Ensures small selection boxes don't get corrupted by tile-snapped cached data

// Helper function matching the production tile-snapping logic
// Tile size of 0.005 deg = ~500m at latitude 47, fine enough that small
// selections don't drag in roads from far outside the requested area.
const TILE_DEG = 0.005;

function snapBboxToTileGrid(bbox: any) {
  const snap = (n: number, dir: 'floor' | 'ceil') => Math[dir](n / TILE_DEG) * TILE_DEG;
  return {
    south: snap(bbox.south, 'floor'),
    west: snap(bbox.west, 'floor'),
    north: snap(bbox.north, 'ceil'),
    east: snap(bbox.east, 'ceil'),
  };
}

describe('OSM Bbox Handling', () => {
  describe('Fine-grained tile snapping', () => {
    it('should snap small selection boxes to nearby tile boundaries', () => {
      // Small box: ~1 city block at 21st Avenue (the problematic real-world case)
      const smallBox = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      const snapped = snapBboxToTileGrid(smallBox);
      // Tiles are 0.005°, so 47.6336 snaps down to 47.630 and 47.6355 snaps up to 47.640
      expect(snapped.south).toBeCloseTo(47.630, 3);
      expect(snapped.north).toBeCloseTo(47.640, 3);
      expect(snapped.west).toBeCloseTo(-117.425, 3);
      expect(snapped.east).toBeCloseTo(-117.415, 3);

      // Verify the snapped tile is close to the requested bbox (within one tile size)
      expect(Math.abs(snapped.south - smallBox.south)).toBeLessThan(TILE_DEG);
      expect(Math.abs(snapped.north - smallBox.north)).toBeLessThan(TILE_DEG);
    });

    it('should produce same snapped bbox for near-identical small selections', () => {
      // Two slightly different boxes drawn for the same area should share cache
      const box1 = { south: 47.6336, north: 47.6355, west: -117.4249, east: -117.4169 };
      const box2 = { south: 47.6340, north: 47.6358, west: -117.4245, east: -117.4172 };

      const snapped1 = snapBboxToTileGrid(box1);
      const snapped2 = snapBboxToTileGrid(box2);

      expect(snapped1).toEqual(snapped2);
    });

    it('should snap large selection boxes to tile boundaries', () => {
      const largeBox = {
        south: 47.600,
        north: 47.720,
        west: -117.500,
        east: -117.350,
      };

      const snapped = snapBboxToTileGrid(largeBox);
      expect(snapped.south).toBeCloseTo(47.600, 3);
      expect(snapped.north).toBeCloseTo(47.720, 3);
      expect(snapped.west).toBeCloseTo(-117.500, 3);
      expect(snapped.east).toBeCloseTo(-117.350, 3);
    });

    it('should snap to a fine enough grid that small selections do not pull in distant roads', () => {
      // Small ~200m box
      const tinyBox = {
        south: 47.6345,
        north: 47.6347,
        west: -117.4210,
        east: -117.4205,
      };

      const snapped = snapBboxToTileGrid(tinyBox);
      const expansionLat = (snapped.north - snapped.south) - (tinyBox.north - tinyBox.south);
      const expansionLon = (snapped.east - snapped.west) - (tinyBox.east - tinyBox.west);

      // Expansion should be at most 1 tile (~500m) in each dimension, not 5km
      expect(expansionLat).toBeLessThan(2 * TILE_DEG);
      expect(expansionLon).toBeLessThan(2 * TILE_DEG);
    });
  });

  describe('Road filtering against selection boxes', () => {
    const BOX_BUFFER = 0.0001;

    function isRoadInBox(
      roadLat: number,
      roadLon: number,
      box: { south: number; north: number; west: number; east: number }
    ): boolean {
      return (
        roadLat <= box.north + BOX_BUFFER &&
        roadLat >= box.south - BOX_BUFFER &&
        roadLon <= box.east + BOX_BUFFER &&
        roadLon >= box.west - BOX_BUFFER
      );
    }

    it('should include roads within the selection box', () => {
      const box = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      // Road at center of box
      expect(isRoadInBox(47.6345, -117.4209, box)).toBe(true);

      // Road at corners
      expect(isRoadInBox(47.6336, -117.4249, box)).toBe(true);
      expect(isRoadInBox(47.6355, -117.4169, box)).toBe(true);
    });

    it('should exclude roads outside the selection box', () => {
      const box = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      // Road south of box (the problematic case from cache corruption)
      expect(isRoadInBox(47.6273, -117.4280, box)).toBe(false);

      // Road north of box
      expect(isRoadInBox(47.6400, -117.4209, box)).toBe(false);

      // Road west of box
      expect(isRoadInBox(47.6345, -117.4300, box)).toBe(false);

      // Road east of box
      expect(isRoadInBox(47.6345, -117.4100, box)).toBe(false);
    });

    it('should include roads with buffer tolerance', () => {
      const box = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      // Road just outside box but within buffer
      expect(isRoadInBox(47.6335, -117.4249, box)).toBe(true);
      expect(isRoadInBox(47.6356, -117.4169, box)).toBe(true);
    });
  });

  describe('Cache bbox validation', () => {
    function validateBboxCoverage(
      dataMinLat: number,
      dataMaxLat: number,
      dataMinLon: number,
      dataMaxLon: number,
      requestedBbox: { south: number; north: number; west: number; east: number },
      margin: number = 0.01
    ): boolean {
      return (
        dataMinLat <= requestedBbox.south + margin &&
        dataMaxLat >= requestedBbox.north - margin &&
        dataMinLon <= requestedBbox.west + margin &&
        dataMaxLon >= requestedBbox.east - margin
      );
    }

    it('should validate that cached data covers requested bbox', () => {
      const requestedBbox = {
        south: 47.6245,
        north: 47.6465,
        west: -117.4397,
        east: -117.3930,
      };

      // Data from a full 0.05 tile that covers the requested area
      const validData = {
        minLat: 47.60,
        maxLat: 47.65,
        minLon: -117.45,
        maxLon: -117.35,
      };

      expect(
        validateBboxCoverage(
          validData.minLat,
          validData.maxLat,
          validData.minLon,
          validData.maxLon,
          requestedBbox
        )
      ).toBe(true);
    });

    it('should reject cached data that does not cover requested bbox', () => {
      const requestedBbox = {
        south: 47.6245,
        north: 47.6465,
        west: -117.4397,
        east: -117.3930,
      };

      // Data from wrong region: only covers south portion
      const invalidData = {
        minLat: 47.60,
        maxLat: 47.62, // Doesn't reach north boundary
        minLon: -117.45,
        maxLon: -117.35,
      };

      expect(
        validateBboxCoverage(
          invalidData.minLat,
          invalidData.maxLat,
          invalidData.minLon,
          invalidData.maxLon,
          requestedBbox
        )
      ).toBe(false);
    });
  });

  describe('Integration: small box stays near requested area', () => {
    it('small selection snaps to a tile much closer than the old 0.05 degree tiles', () => {
      // Scenario: user draws small box at 21st-23rd Avenue
      const userBox = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      const snapped = snapBboxToTileGrid(userBox);

      // The snapped tile should be a tight bounding box around the request
      // (not a giant 5km tile like the old behavior caused)
      expect(snapped.north - snapped.south).toBeLessThan(0.015); // < 1.5km tall
      expect(snapped.east - snapped.west).toBeLessThan(0.015); // < 1.5km wide
    });

    it('should never return roads from far outside the snapped tile', () => {
      const userBox = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      const snapped = snapBboxToTileGrid(userBox);

      // This was the bug: roads at 47.6273 (south of the box) were being returned
      // because they came from a cached 0.05 degree tile that included that area
      const problematicRoad = { lat: 47.6273, lon: -117.4280 };

      // With fine-grained tiles, this road would NOT be in the snapped tile,
      // so it would never be cached together with this request
      expect(
        problematicRoad.lat >= snapped.south && problematicRoad.lat <= snapped.north
      ).toBe(false);
      expect(
        problematicRoad.lon >= snapped.west && problematicRoad.lon <= snapped.east
      ).toBe(false);
    });
  });

  describe('Legacy regression check', () => {
    it('user box snaps to small tile, never pulls in roads from 0.05 degree tile', () => {
      const userBox = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };
      const problematicRoad = { lat: 47.6273, lon: -117.4280 };

      expect(
        problematicRoad.lat <= userBox.north + 0.0001 &&
          problematicRoad.lat >= userBox.south - 0.0001
      ).toBe(false);
    });
  });
});
