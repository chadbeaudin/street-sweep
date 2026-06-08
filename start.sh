#!/bin/bash
# Kill any previous instances
killall -9 node 2>/dev/null || true
sleep 1
npm run dev > /tmp/streetsweep.log 2>&1
