#!/bin/bash
# Kills whatever is listening on the dev server port (default 3888).
PORT="${1:-3888}"
PID=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN)
if [ -n "$PID" ]; then
  kill -9 $PID
  echo "Killed process(es) on port $PORT: $PID"
else
  echo "No process listening on port $PORT"
fi
