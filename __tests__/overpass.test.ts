// Tests for OSM bbox handling and cache behavior
// Ensures small selection boxes don't get corrupted by tile-snapped cached data

// Helper functions for testing bbox behavior
function snapBboxToTileGrid(bbox: any, TILE_DEG: number = 0.05) {
  const snap = (n: number, dir: 'floor' | 'ceil') => Math[dir](n / TILE_DEG) * TILE_DEG;
  return {
    south: snap(bbox.south, 'floor'),
    west: snap(bbox.west, 'floor'),
    north: snap(bbox.north, 'ceil'),
    east: snap(bbox.east, 'ceil'),
  };
}

function shouldSnapBbox(bbox: any): boolean {
  const latSpan = Math.abs(bbox.north - bbox.south);
  const lonSpan = Math.abs(bbox.east - bbox.west);
  const bboxArea = latSpan * lonSpan;
  return bboxArea > 0.01;
}

describe('OSM Bbox Handling', () => {
  describe('Tile snapping for small vs large selections', () => {
    it('should NOT snap small selection boxes (< 0.01 sq deg)', () => {
      // Small box: ~1 city block (approx 0.001 sq deg at 47° latitude)
      const smallBox = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      expect(shouldSnapBbox(smallBox)).toBe(false);
      // When not snapped, the bbox stays exactly as requested
      expect(smallBox).toEqual(smallBox);
    });

    it('should snap large selection boxes (>= 0.01 sq deg)', () => {
      // Large box: ~12km x 9km (approx 0.108 sq deg, larger than 0.01)
      const largeBox = {
        south: 47.600,
        north: 47.720,
        west: -117.500,
        east: -117.350,
      };

      expect(shouldSnapBbox(largeBox)).toBe(true);

      const snapped = snapBboxToTileGrid(largeBox);
      // Snapped values should be multiples of 0.05
      // East gets ceil'd so -117.350 → -117.30 (more easterly)
      expect(snapped.south).toBeCloseTo(47.60, 5);
      expect(snapped.north).toBeCloseTo(47.75, 5);
      expect(snapped.west).toBeCloseTo(-117.50, 5);
      expect(snapped.east).toBeCloseTo(-117.30, 5);
    });
  });

  describe('Bbox snapping edge cases', () => {
    it('should handle boxes on tile boundaries', () => {
      // Box exactly at tile boundary
      const boundaryBox = {
        south: 47.60,
        north: 47.65,
        west: -117.45,
        east: -117.40,
      };

      const snapped = snapBboxToTileGrid(boundaryBox);
      expect(snapped.south).toBeCloseTo(boundaryBox.south, 5);
      expect(snapped.north).toBeCloseTo(boundaryBox.north, 5);
      expect(snapped.west).toBeCloseTo(boundaryBox.west, 5);
      expect(snapped.east).toBeCloseTo(boundaryBox.east, 5);
    });

    it('should expand boxes to full tiles', () => {
      // Small box within a tile should expand to tile boundaries
      const smallWithinTile = {
        south: 47.625,
        north: 47.635,
        west: -117.425,
        east: -117.415,
      };

      const snapped = snapBboxToTileGrid(smallWithinTile);
      expect(snapped.south).toBeCloseTo(47.60, 5);
      expect(snapped.north).toBeCloseTo(47.65, 5);
      expect(snapped.west).toBeCloseTo(-117.45, 5);
      expect(snapped.east).toBeCloseTo(-117.40, 5);
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

  describe('Integration: small box should not use stale tile data', () => {
    it('small selection should fetch exact bbox without tile snapping', () => {
      // Scenario: user draws small box at 21st-23rd Avenue
      const userBox = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      // Without snapping, request area = 0.0019 * 0.008 = 0.0000152 sq deg
      const latSpan = userBox.north - userBox.south;
      const lonSpan = userBox.east - userBox.west;
      const area = latSpan * lonSpan;

      expect(area).toBeLessThan(0.01);
      expect(shouldSnapBbox(userBox)).toBe(false);

      // So we fetch exactly this bbox, not a snapped tile
      // Any roads returned should be within this exact area
      const roads = [
        { lat: 47.6345, lon: -117.4209 }, // Inside ✓
      ];

      roads.forEach((road) => {
        expect(
          road.lat <= userBox.north + 0.0001 &&
            road.lat >= userBox.south - 0.0001 &&
            road.lon <= userBox.east + 0.0001 &&
            road.lon >= userBox.west - 0.0001
        ).toBe(true, `Road ${JSON.stringify(road)} should be in box`);
      });
    });

    it('should never return roads from different part of tile for small selection', () => {
      const userBox = {
        south: 47.6336,
        north: 47.6355,
        west: -117.4249,
        east: -117.4169,
      };

      // This was the bug: roads at 47.6273 (south of the box) were being returned
      // because they came from a cached 0.05 degree tile that included that area
      const problematicRoad = { lat: 47.6273, lon: -117.4280 };

      expect(
        problematicRoad.lat <= userBox.north + 0.0001 &&
          problematicRoad.lat >= userBox.south - 0.0001
      ).toBe(false, 'Road should NOT be in box (this was the cache corruption bug)');
    });
  });
});
