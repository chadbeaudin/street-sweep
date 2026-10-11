#!/bin/bash
# Kill whatever's holding the dev port. `killall -9 node` alone doesn't work
# here: Next.js renames its process title to "next-server (vX)" on macOS, so
# a name-based kill silently misses it and old servers pile up across
# restarts. Killing by port is robust regardless of process name.
PORT=3888
lsof -ti ":$PORT" | xargs -r kill -9 2>/dev/null || true
killall -9 node 2>/dev/null || true
sleep 1
npm run dev > /tmp/streetsweep.log 2>&1 &
DEV_PID=$!
# Background jobs in a non-interactive shell ignore Ctrl-C, so stop them explicitly.
trap 'kill $WORKER_PID $DEV_PID 2>/dev/null' EXIT INT TERM

# The worker gives up after ~1 minute of failed ticks, so wait for the server first.
until curl -s -o /dev/null "http://localhost:$PORT"; do
    kill -0 $DEV_PID 2>/dev/null || exit 1
    sleep 1
done
node scripts/worker-tick-loop.js > /tmp/streetsweep-worker.log 2>&1 &
WORKER_PID=$!
wait $DEV_PID
