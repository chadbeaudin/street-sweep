let recordTickResult: typeof import('./worker-tick-loop').recordTickResult;
let tick: typeof import('./worker-tick-loop').tick;
let MAX_CONSECUTIVE_FAILURES: number;

describe('worker-tick-loop failure tracking', () => {
    beforeEach(() => {
        jest.resetModules();
        ({ recordTickResult, tick, MAX_CONSECUTIVE_FAILURES } = require('./worker-tick-loop'));
    });

    test('resets failure count on success', () => {
        expect(recordTickResult(true, 5)).toBe(0);
    });

    test('increments failure count on failure', () => {
        expect(recordTickResult(false, 5)).toBe(6);
    });

    test('tick exits the process once consecutive failures hit the threshold', async () => {
        const failingFetch = jest.fn().mockRejectedValue(new Error('fetch failed'));
        const exitFn = jest.fn();

        for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
            await tick(failingFetch, exitFn);
        }

        expect(exitFn).toHaveBeenCalledTimes(1);
        expect(exitFn).toHaveBeenCalledWith(1);
    });

    test('tick does not exit while a success resets the streak', async () => {
        const fetchFn = jest
            .fn()
            .mockRejectedValueOnce(new Error('fetch failed'))
            .mockResolvedValueOnce(undefined);
        const exitFn = jest.fn();

        await tick(fetchFn, exitFn);
        await tick(fetchFn, exitFn);

        expect(exitFn).not.toHaveBeenCalled();
    });
});
