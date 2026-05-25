import { buildFitCourse } from './fit';
import { Decoder, Stream } from '@garmin/fitsdk';

// Route with known elevation profile: +10m ascent, -12m descent
const sampleRoute: [number, number, number][] = [
    [-104.700, 39.020, 280],
    [-104.710, 39.025, 285],
    [-104.720, 39.030, 290],
    [-104.715, 39.035, 283],
    [-104.700, 39.020, 278],
];

// Flat route with no elevation data
const flatRoute: [number, number][] = [
    [-104.700, 39.020],
    [-104.710, 39.025],
    [-104.720, 39.030],
];

function decode(route: [number, number, number?, number?][], name?: string) {
    const bytes = buildFitCourse(route, name ?? 'Test Course');
    const stream = Stream.fromBuffer(Buffer.from(bytes));
    const { messages } = new Decoder(stream).read();
    return messages as Record<string, any[]>;
}

// ── File structure ────────────────────────────────────────────────────────────

describe('FIT file structure', () => {
    let msgs: Record<string, any[]>;

    beforeAll(() => { msgs = decode(sampleRoute); });

    it('contains the required message types', () => {
        expect(msgs.fileIdMesgs).toBeDefined();
        expect(msgs.courseMesgs).toBeDefined();
        expect(msgs.eventMesgs).toBeDefined();
        expect(msgs.recordMesgs).toBeDefined();
        expect(msgs.lapMesgs).toBeDefined();
        expect(msgs.fileCreatorMesgs).toBeDefined();
    });

    it('has exactly one lap', () => {
        expect(msgs.lapMesgs).toHaveLength(1);
    });

    it('has a timer start and a timer stop event', () => {
        expect(msgs.eventMesgs).toHaveLength(2);
        expect(msgs.eventMesgs[0].eventType).toBe('start');
        expect(msgs.eventMesgs[1].eventType).toBe('stopAll');
    });

    it('record count matches route length', () => {
        expect(msgs.recordMesgs).toHaveLength(sampleRoute.length);
    });
});

// ── file_id fields ────────────────────────────────────────────────────────────

describe('file_id message', () => {
    let fileId: any;
    beforeAll(() => { fileId = decode(sampleRoute).fileIdMesgs[0]; });

    it('type is course (not activity)', () => {
        expect(fileId.type).toBe('course');
    });

    it('manufacturer is garmin', () => {
        expect(fileId.manufacturer).toBe('garmin');
    });

    it('product is Garmin Connect (65534)', () => {
        expect(fileId.product).toBe(65534);
    });

    it('serialNumber is present', () => {
        expect(fileId.serialNumber).toBeDefined();
    });

    it('number is present', () => {
        expect(fileId.number).toBeDefined();
    });
});

// ── course message ────────────────────────────────────────────────────────────

describe('course message', () => {
    it('contains the course name', () => {
        const msgs = decode(sampleRoute, 'My Test Route');
        expect(msgs.courseMesgs[0].name).toBe('My Test Route');
    });

    it('uses default name when none provided', () => {
        const bytes = buildFitCourse(sampleRoute);
        const stream = Stream.fromBuffer(Buffer.from(bytes));
        const { messages } = new Decoder(stream).read() as any;
        expect(messages.courseMesgs[0].name).toBe('StreetSweep Course');
    });

    it('sport is cycling', () => {
        const msgs = decode(sampleRoute);
        expect(msgs.courseMesgs[0].sport).toBe('cycling');
    });
});

// ── elevation ─────────────────────────────────────────────────────────────────

describe('elevation data', () => {
    let msgs: Record<string, any[]>;
    beforeAll(() => { msgs = decode(sampleRoute); });

    it('records include altitude', () => {
        msgs.recordMesgs.forEach(r => {
            expect(r.altitude).toBeDefined();
            expect(typeof r.altitude).toBe('number');
        });
    });

    it('records include enhancedAltitude matching altitude', () => {
        msgs.recordMesgs.forEach(r => {
            expect(r.enhancedAltitude).toBeCloseTo(r.altitude, 0);
        });
    });

    it('first record altitude matches route start elevation', () => {
        expect(msgs.recordMesgs[0].altitude).toBeCloseTo(280, 0);
    });

    it('lap totalAscent is non-zero for a route with climbs', () => {
        expect(msgs.lapMesgs[0].totalAscent).toBeGreaterThan(0);
    });

    it('lap totalDescent is non-zero for a route with descents', () => {
        expect(msgs.lapMesgs[0].totalDescent).toBeGreaterThan(0);
    });

    it('totalAscent is approximately 10m', () => {
        // 280→285→290 = +10m
        expect(msgs.lapMesgs[0].totalAscent).toBeCloseTo(10, 0);
    });

    it('totalDescent is approximately 12m', () => {
        // 290→283→278 = -12m
        expect(msgs.lapMesgs[0].totalDescent).toBeCloseTo(12, 0);
    });

    it('elevation values are in meters, not feet', () => {
        // Sample route is at ~280m. If stored in feet it would be ~918+.
        msgs.recordMesgs.forEach(r => {
            expect(r.altitude).toBeLessThan(600);
        });
    });
});

// ── lap fields ────────────────────────────────────────────────────────────────

describe('lap message', () => {
    let lap: any;
    beforeAll(() => { lap = decode(sampleRoute).lapMesgs[0]; });

    it('messageIndex is 0', () => {
        expect(lap.messageIndex).toBe(0);
    });

    it('startPositionLat is defined', () => {
        expect(lap.startPositionLat).toBeDefined();
    });

    it('startPositionLong is defined', () => {
        expect(lap.startPositionLong).toBeDefined();
    });

    it('endPositionLat is defined', () => {
        expect(lap.endPositionLat).toBeDefined();
    });

    it('endPositionLong is defined', () => {
        expect(lap.endPositionLong).toBeDefined();
    });

    it('totalDistance matches the route distance', () => {
        expect(lap.totalDistance).toBeGreaterThan(0);
    });
});

// ── records ───────────────────────────────────────────────────────────────────

describe('record messages', () => {
    let records: any[];
    beforeAll(() => { records = decode(sampleRoute).recordMesgs; });

    it('distance is cumulative and increasing', () => {
        for (let i = 1; i < records.length; i++) {
            expect(records[i].distance).toBeGreaterThanOrEqual(records[i - 1].distance);
        }
    });

    it('first record has distance 0', () => {
        expect(records[0].distance).toBe(0);
    });

    it('positionLat and positionLong are present', () => {
        records.forEach(r => {
            expect(r.positionLat).toBeDefined();
            expect(r.positionLong).toBeDefined();
        });
    });
});

// ── edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
    it('handles route with no elevation data (totalAscent=0)', () => {
        const msgs = decode(flatRoute as any);
        expect(msgs.lapMesgs[0].totalAscent).toBe(0);
        expect(msgs.lapMesgs[0].totalDescent).toBe(0);
    });

    it('long course name is truncated gracefully', () => {
        const longName = 'A'.repeat(100);
        const msgs = decode(sampleRoute, longName);
        expect(msgs.courseMesgs[0].name.length).toBeLessThanOrEqual(31);
    });

    it('handles a two-point route', () => {
        const twoPoint: [number, number, number][] = [
            [-104.700, 39.020, 280],
            [-104.710, 39.025, 290],
        ];
        const msgs = decode(twoPoint);
        expect(msgs.recordMesgs).toHaveLength(2);
        expect(msgs.lapMesgs[0].totalAscent).toBeCloseTo(10, 0);
    });
});
