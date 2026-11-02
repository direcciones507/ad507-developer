#!/bin/sh
set -eu
# Railway mounts fresh volumes as root. Initialize only this agent's fixed private directory,
# then drop privileges before the HTTP server, Git or model orchestration starts.
if [ "$(id -u)" = 0 ]; then
  [ "${AD507_DATA_DIR:-/data/ad507}" = /data/ad507 ] || { echo DATA_DIRECTORY_REQUIRES_REVIEW >&2; exit 1; }
  [ ! -L /data/ad507 ] || { echo DATA_DIRECTORY_LINK_REJECTED >&2; exit 1; }
  install -d -m 700 -o node -g node /data/ad507
  exec gosu node "$@"
fi
exec "$@"
