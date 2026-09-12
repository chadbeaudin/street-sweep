#!/bin/bash
# Kill whatever's holding the dev port. `killall -9 node` alone doesn't work
# here: Next.js renames its process title to "next-server (vX)" on macOS, so
# a name-based kill silently misses it and old servers pile up across
# restarts. Killing by port is robust regardless of process name.
PORT=3888
lsof -ti ":$PORT" | xargs -r kill -9 2>/dev/null || true
killall -9 node 2>/dev/null || true
sleep 1
npm run dev > /tmp/streetsweep.log 2>&1
