// Pure-binary FIT encoder — Refined based on working Velotron Converter logic.
const FIT_EPOCH_OFFSET = 631065600;
import { haversineM, toSemicircles } from './geometry';

const UINT8  = 0x02;
const UINT16 = 0x84;
const UINT32 = 0x86;
const SINT32 = 0x85;
const STRING = 0x07;

function fitNow(): number {
    return Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET;
}

const CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
                   0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];

function calcCRC(buf: number[]): number {
    let crc = 0;
    for (const byte of buf) {
        let tmp = CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc ^= tmp ^ CRC_TABLE[byte & 0xF];
        tmp = CRC_TABLE[crc & 0xF];     crc = (crc >> 4) & 0x0FFF; crc ^= tmp ^ CRC_TABLE[(byte >> 4) & 0xF];
    }
    return crc;
}

const u8  = (b: number[], v: number) => b.push(v & 0xFF);
const u16 = (b: number[], v: number) => b.push(v & 0xFF, (v >> 8) & 0xFF);
const u32 = (b: number[], v: number) => b.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF);
const s32 = (b: number[], v: number) => u32(b, v < 0 ? v + 0x100000000 : v);
const str = (b: number[], s: string, len: number) => {
    for (let i = 0; i < len; i++) b.push(i < s.length ? s.charCodeAt(i) : 0);
};

function def(local: number, global: number, fields: [number, number, number][]): number[] {
    const b: number[] = [0x40 | local, 0x00, 0x00];
    u16(b, global);
    u8(b, fields.length);
    for (const [fn, sz, bt] of fields) { u8(b, fn); u8(b, sz); u8(b, bt); }
    return b;
}

export function buildFitActivity(
    route: [number, number, number?, number?][],
    name = 'StreetSweep Route'
): Uint8Array {
    const data: number[] = [];
    const ts = fitNow();

    // ── file_id (local 0, global 0) ──────────────────────────────────────────
    data.push(...def(0, 0, [
        [0, 1, UINT8],  // type
        [1, 2, UINT16], // manufacturer
        [2, 2, UINT16], // product
        [4, 4, UINT32], // time_created
    ]));
    data.push(0);
    u8(data, 4);          // type = activity (4)
    u16(data, 1);         // manufacturer = garmin (1)
    u16(data, 3121);      // product = Edge 530 (matches working reference)
    u32(data, ts);        // time_created

    // ── event (local 4, global 21) - Timer Start ─────────────────────────────
    data.push(...def(4, 21, [
        [253, 4, UINT32], // timestamp
        [0,   1, UINT8],  // event
        [1,   1, UINT8],  // event_type
    ]));
    data.push(4);
    u32(data, ts);
    u8(data, 0); // event = timer
    u8(data, 0); // event_type = start

    // ── record definition (local 2, global 20) ───────────────────────────────
    const withAlt = route.some(p => p[2] !== undefined && p[2] !== null);
    const recFields: [number, number, number][] = [
        [253, 4, UINT32], // timestamp
        [0,   4, SINT32], // position_lat
        [1,   4, SINT32], // position_long
        [5,   4, UINT32], // distance (cm)
    ];
    if (withAlt) recFields.push([2, 2, UINT16]); // altitude
    data.push(...def(2, 20, recFields));

    // ── record data ──────────────────────────────────────────────────────────
    let totalDistCm = 0;
    for (let i = 0; i < route.length; i++) {
        const [lon, lat, ele] = route[i];
        if (i > 0) {
            const [plon, plat] = route[i - 1];
            totalDistCm += Math.round(haversineM(plat, plon, lat, lon) * 100);
        }
        data.push(2);
        u32(data, ts + i);
        s32(data, toSemicircles(lat));
        s32(data, toSemicircles(lon));
        u32(data, totalDistCm);
        if (withAlt) u16(data, Math.max(0, Math.round(((ele ?? 0) + 500) * 5)));
    }

    const endTs = ts + route.length;
    const durationMs = route.length * 1000;

    // ── lap (local 3, global 19) ─────────────────────────────────────────────
    data.push(...def(3, 19, [
        [253, 4, UINT32], // timestamp
        [2,   4, UINT32], // start_time
        [7,   4, UINT32], // total_elapsed_time (ms)
        [8,   4, UINT32], // total_timer_time (ms)
        [9,   4, UINT32], // total_distance (cm)
    ]));
    data.push(3);
    u32(data, endTs);
    u32(data, ts);          // start_time
    u32(data, durationMs);  // total_elapsed_time
    u32(data, durationMs);  // total_timer_time
    u32(data, totalDistCm); // total_distance

    // ── session (local 5, global 18) ─────────────────────────────────────────
    data.push(...def(5, 18, [
        [253, 4, UINT32], // timestamp
        [2,   4, UINT32], // start_time
        [7,   4, UINT32], // total_elapsed_time (ms)
        [8,   4, UINT32], // total_timer_time (ms)
        [9,   4, UINT32], // total_distance (cm)
        [5,   1, UINT8],  // sport
    ]));
    data.push(5);
    u32(data, endTs);
    u32(data, ts);
    u32(data, durationMs);
    u32(data, durationMs);
    u32(data, totalDistCm);
    u8(data, 2); // sport = cycling

    const dataSize = data.length;
    const header: number[] = [0x0E, 0x20, 0xD0, 0x52, dataSize & 0xFF, (dataSize >> 8) & 0xFF, (dataSize >> 16) & 0xFF, (dataSize >> 24) & 0xFF, 0x2E, 0x46, 0x49, 0x54];
    u16(header, calcCRC(header));

    const full = [...header, ...data];
    u16(full, calcCRC(full));

    return new Uint8Array(full);
}

export const buildFitCourse = buildFitActivity;
