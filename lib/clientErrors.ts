// Failures a user actually saw (or a click that silently did nothing), reported
// from the browser and counted on /admin (#117). Only the kind is sent, never
// the message or anything about the route.
export const CLIENT_ERROR_KINDS = [
    'generate', 'step', 'point_move', 'point_delete', 'segment_insert', 'avoid_snap',
    'roads_load', 'strava_connect', 'stats', 'stats_year', 'import', 'fit_download',
    'garmin_export', 'library_browse', 'library_load', 'library_upload', 'library_save',
    'account_delete', 'js_error', 'unhandled_rejection',
] as const;

export type ClientErrorKind = typeof CLIENT_ERROR_KINDS[number];

// One report per kind per browser in this window, so an error loop can't flood the endpoint.
const THROTTLE_MS = 10 * 1000;
const lastSent = new Map<ClientErrorKind, number>();

export function reportClientError(kind: ClientErrorKind, now = Date.now()): void {
    if (now - (lastSent.get(kind) ?? -Infinity) < THROTTLE_MS) return;
    lastSent.set(kind, now);
    fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
        keepalive: true,
    }).catch(() => { /* reporting must never cause an error of its own */ });
}

export function resetClientErrorThrottle(): void {
    lastSent.clear();
}

// Browser extensions throw into the page too; those aren't the app's errors.
function isExtensionError(event: ErrorEvent): boolean {
    return /^(chrome|moz|safari(-web)?)-extension:/.test(event.filename ?? '');
}

// Returns a function that removes the listeners.
export function installGlobalErrorReporting(target: Window = window): () => void {
    const onError = (event: ErrorEvent) => {
        if (!isExtensionError(event)) reportClientError('js_error');
    };
    const onRejection = (event: PromiseRejectionEvent) => {
        if ((event.reason as { name?: string } | undefined)?.name !== 'AbortError') reportClientError('unhandled_rejection');
    };
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
    };
}
