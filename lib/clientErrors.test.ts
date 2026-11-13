/**
 * @jest-environment jsdom
 */
import { reportClientError, resetClientErrorThrottle, installGlobalErrorReporting } from './clientErrors';

const sentKinds = () => (global.fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body).kind);

beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    resetClientErrorThrottle();
});

describe('reportClientError (#117)', () => {
    it('sends only the kind, to the client-error endpoint', () => {
        reportClientError('step', 1000);
        expect(global.fetch).toHaveBeenCalledWith('/api/client-error', expect.objectContaining({ method: 'POST', body: JSON.stringify({ kind: 'step' }), keepalive: true }));
    });

    it('sends each kind at most once per 10 seconds, so an error loop cannot flood it', () => {
        reportClientError('step', 1000);
        reportClientError('step', 5000);
        reportClientError('generate', 5000);
        reportClientError('step', 11_001);
        expect(sentKinds()).toEqual(['step', 'generate', 'step']);
    });

    it('never throws when reporting itself fails', async () => {
        global.fetch = jest.fn().mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch;
        expect(() => reportClientError('import', 1000)).not.toThrow();
        await Promise.resolve();
    });
});

describe('installGlobalErrorReporting (#117)', () => {
    it('reports uncaught errors and rejections, skipping browser extensions and aborted requests', () => {
        const remove = installGlobalErrorReporting(window);
        window.dispatchEvent(new ErrorEvent('error', { filename: 'chrome-extension://abc/content.js' }));
        window.dispatchEvent(new ErrorEvent('error', { filename: 'http://localhost/_next/static/chunks/app.js' }));
        const aborted = new Event('unhandledrejection') as Event & { reason?: unknown };
        aborted.reason = { name: 'AbortError' };
        window.dispatchEvent(aborted);
        const failed = new Event('unhandledrejection') as Event & { reason?: unknown };
        failed.reason = new Error('boom');
        window.dispatchEvent(failed);
        expect(sentKinds()).toEqual(['js_error', 'unhandled_rejection']);

        remove();
        resetClientErrorThrottle();
        window.dispatchEvent(new ErrorEvent('error', { filename: 'http://localhost/app.js' }));
        expect(sentKinds()).toHaveLength(2);
    });
});
