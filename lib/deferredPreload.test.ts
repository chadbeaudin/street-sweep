import { preloadAfter } from './deferredPreload';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('preloadAfter', () => {
    it('starts every loader once the delay has passed, not before', () => {
        const a = jest.fn(() => Promise.resolve());
        const b = jest.fn(() => Promise.resolve());
        preloadAfter(5000, [a, b]);
        jest.advanceTimersByTime(4999);
        expect(a).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('reports when everything has loaded', async () => {
        const onLoaded = jest.fn();
        preloadAfter(10, [() => Promise.resolve(), () => Promise.resolve()], onLoaded);
        jest.advanceTimersByTime(10);
        await Promise.resolve(); await Promise.resolve();
        expect(onLoaded).toHaveBeenCalledTimes(1);
    });

    it('does not report a failed preload as loaded', async () => {
        const onLoaded = jest.fn();
        preloadAfter(10, [() => Promise.reject(new Error('chunk failed'))], onLoaded);
        jest.advanceTimersByTime(10);
        await Promise.resolve(); await Promise.resolve();
        expect(onLoaded).not.toHaveBeenCalled();
    });

    it('does not report after being cancelled mid-load', async () => {
        const onLoaded = jest.fn();
        let finish!: () => void;
        const cancel = preloadAfter(10, [() => new Promise<void>(r => { finish = r; })], onLoaded);
        jest.advanceTimersByTime(10);
        cancel();
        finish();
        await Promise.resolve(); await Promise.resolve();
        expect(onLoaded).not.toHaveBeenCalled();
    });

    it('does nothing if cancelled first', () => {
        const a = jest.fn(() => Promise.resolve());
        preloadAfter(5000, [a])();
        jest.advanceTimersByTime(10000);
        expect(a).not.toHaveBeenCalled();
    });

    it('swallows a failed preload', async () => {
        const failing = jest.fn(() => Promise.reject(new Error('chunk failed')));
        const next = jest.fn(() => Promise.resolve());
        preloadAfter(10, [failing, next]);
        jest.advanceTimersByTime(10);
        await Promise.resolve();
        expect(next).toHaveBeenCalled();
    });
});
