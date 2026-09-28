#!/bin/bash
# Runs the ridden-roads worker tick loop against the local dev server
# (start.sh / `npm run dev` must already be running on port 3888) -- mirrors
# how the separate `worker` Fly machine ticks its own local server.js in
# prod (see fly.toml [processes].worker). Requires INTERNAL_WORKER_SECRET in
# .env.local (same value the dev server itself reads).
node scripts/worker-tick-loop.js > /tmp/streetsweep-worker.log 2>&1
