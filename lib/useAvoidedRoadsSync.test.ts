/**
 * @jest-environment jsdom
 */

import { renderHook, waitFor } from '@testing-library/react';
import { useAvoidedRoadsSync } from './useAvoidedRoadsSync';

type Roads = [number, number][][];
const local: Roads = [[[47.6, -117.4], [47.61, -117.41]]];
const saved: Roads = [[[47.7, -117.5], [47.71, -117.51]]];

let fetchMock: jest.Mock;

function mockServer(roads: Roads) {
    fetchMock = jest.fn((url: string, init?: RequestInit) =>
        Promise.resolve({ ok: true, json: async () => (init?.method === 'PUT' ? JSON.parse(init.body as string) : { roads }) })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
}

const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(init.body).roads);

describe('useAvoidedRoadsSync', () => {
    it('does nothing for signed-out users', () => {
        mockServer(saved);
        renderHook(() => useAvoidedRoadsSync('unauthenticated', local, jest.fn()));
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("loads the account's roads on sign-in, replacing this browser's", async () => {
        mockServer(saved);
        const setRoads = jest.fn();
        renderHook(() => useAvoidedRoadsSync('authenticated', local, setRoads));
        await waitFor(() => expect(setRoads).toHaveBeenCalledWith(saved));
        expect(puts()).toEqual([]);
    });

    it("uploads this browser's roads when the account has none yet", async () => {
        mockServer([]);
        const setRoads = jest.fn();
        renderHook(() => useAvoidedRoadsSync('authenticated', local, setRoads));
        await waitFor(() => expect(puts()).toEqual([local]));
        expect(setRoads).not.toHaveBeenCalled();
    });

    it('saves every later change, but not the value it just loaded', async () => {
        mockServer(saved);
        const { rerender } = renderHook(({ roads }) => useAvoidedRoadsSync('authenticated', roads, jest.fn()), { initialProps: { roads: local } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await new Promise(r => setTimeout(r, 0));

        rerender({ roads: saved }); // the loaded value echoed back through state
        expect(puts()).toEqual([]);

        const added: Roads = [...saved, [[47.8, -117.6], [47.81, -117.61]]];
        rerender({ roads: added });
        expect(puts()).toEqual([added]);

        rerender({ roads: [] }); // "clear all"
        expect(puts()).toEqual([added, []]);
    });
});
