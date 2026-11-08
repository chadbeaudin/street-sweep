/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react';
import { useDelayedFlag } from './useDelayedFlag';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const render = (active: boolean) => renderHook(({ active }) => useDelayedFlag(active, 3000), { initialProps: { active } });

describe('useDelayedFlag', () => {
    it('stays hidden for work that finishes before the delay', () => {
        const { result, rerender } = render(true);
        act(() => { jest.advanceTimersByTime(2000); });
        expect(result.current).toBe(false);
        rerender({ active: false });
        act(() => { jest.advanceTimersByTime(5000); });
        expect(result.current).toBe(false);
    });

    it('shows once the work has run for the full delay', () => {
        const { result } = render(true);
        act(() => { jest.advanceTimersByTime(2999); });
        expect(result.current).toBe(false);
        act(() => { jest.advanceTimersByTime(1); });
        expect(result.current).toBe(true);
    });

    it('hides immediately when the work finishes', () => {
        const { result, rerender } = render(true);
        act(() => { jest.advanceTimersByTime(3000); });
        rerender({ active: false });
        expect(result.current).toBe(false);
    });

    it('restarts the wait for the next round of work', () => {
        const { result, rerender } = render(true);
        act(() => { jest.advanceTimersByTime(3000); });
        rerender({ active: false });
        rerender({ active: true });
        act(() => { jest.advanceTimersByTime(1000); });
        expect(result.current).toBe(false);
        act(() => { jest.advanceTimersByTime(2000); });
        expect(result.current).toBe(true);
    });

    it('never shows when idle', () => {
        const { result } = render(false);
        act(() => { jest.advanceTimersByTime(10000); });
        expect(result.current).toBe(false);
    });
});
