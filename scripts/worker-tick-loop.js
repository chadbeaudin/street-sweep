// Ticks the internal ridden-roads worker endpoint on a loop. Run only on the
// isolated `worker` Fly machine (see fly.toml [processes].worker) -- never
// receives public traffic itself, just repeatedly asks the Next.js server
// running alongside it (same machine, loopback only) to process one queued
// recompute job to completion. Zero non-dotenv dependencies (uses Node's
// built-in fetch) so it needs no build step and can run directly in the
// production image. Locally (see start-worker.sh), .env.local isn't loaded
// automatically the way Next.js loads it for `npm run dev` -- load it here
// so INTERNAL_WORKER_SECRET matches between the two processes.
try { require('dotenv').config({ path: '.env.local' }); } catch { /* fine in prod -- env vars come from Fly secrets */ }

const PORT = process.env.PORT || 3888;
const URL = `http://localhost:${PORT}/api/internal/ridden-roads-tick`;
const SECRET = process.env.INTERNAL_WORKER_SECRET;
const POLL_INTERVAL_MS = 5000;
// If the local server.js dies, every tick fails forever with no way to recover
// on its own (this loop doesn't restart it). Past this many consecutive
// connection failures, exit non-zero so the container's init sees process 1's
// job fail and Fly restarts the whole machine, respawning both processes.
const MAX_CONSECUTIVE_FAILURES = 12; // ~1 minute at POLL_INTERVAL_MS

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let consecutiveFailures = 0;

// Pure state-transition step, exported so its exit threshold behavior can be
// unit-tested without real fetch/process.exit.
function recordTickResult(succeeded, failures = consecutiveFailures) {
    if (succeeded) return 0;
    return failures + 1;
}

async function tick(fetchFn = fetch, exitFn = process.exit) {
    try {
        await fetchFn(URL, { method: 'POST', headers: { 'x-internal-secret': SECRET || '' } });
        consecutiveFailures = recordTickResult(true);
    } catch (e) {
        consecutiveFailures = recordTickResult(false);
        console.warn(`[worker-tick-loop] tick failed: ${e.message} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} consecutive)`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error('[worker-tick-loop] too many consecutive failures, exiting so Fly restarts the machine');
            exitFn(1);
        }
    }
}

async function main() {
    if (!SECRET) console.warn('[worker-tick-loop] INTERNAL_WORKER_SECRET is not set -- every tick will be rejected');
    // eslint-disable-next-line no-constant-condition
    while (true) {
        await tick();
        await delay(POLL_INTERVAL_MS);
    }
}

module.exports = { recordTickResult, tick, MAX_CONSECUTIVE_FAILURES };

if (require.main === module) main();
