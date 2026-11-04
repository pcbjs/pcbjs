#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux ]]; then
  echo 'Headless VS Code acceptance requires a local Linux environment. See tests/installed-host/README.md for Linux prerequisites and optional macOS desktop checks.' >&2
  exit 2
fi

here="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" != --inside-display ]]; then
  for dependency in node xvfb-run xauth dbus-run-session openbox; do
    command -v "$dependency" >/dev/null || { echo "Missing headless prerequisite: $dependency" >&2; exit 2; }
  done
  # Each invocation owns a fresh X display and D-Bus session. No owner desktop.
  exec dbus-run-session -- xvfb-run -a -s '-screen 0 1920x1200x24 -nolisten tcp' bash "$0" --inside-display "$@"
fi
shift
export PCBJS_TEST_VIRTUAL_DISPLAY=1
export LIBGL_ALWAYS_SOFTWARE=1
openbox --sm-disable &
wm_pid=$!
trap 'kill "$wm_pid" 2>/dev/null || true; wait "$wm_pid" 2>/dev/null || true' EXIT
node "$here/run.mjs" --headless "$@"
