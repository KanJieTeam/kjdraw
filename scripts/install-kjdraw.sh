#!/bin/sh
set -eu

case "$0" in
  -|sh|bash) echo 'KJDraw installer: run a checked-out local script, not a piped URL' >&2; exit 1 ;;
esac
if ! command -v node >/dev/null 2>&1; then
  echo 'KJDraw installer: existing Node.js >=22 is required' >&2
  exit 1
fi
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
if [ ! -f "$script_dir/install-kjdraw.mjs" ]; then
  echo 'KJDraw installer: local installer core is missing' >&2
  exit 1
fi
exec node "$script_dir/install-kjdraw.mjs" "$@"
