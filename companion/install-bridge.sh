#!/bin/sh
# Install the bridge between the browser extension and the companion program (macOS and Linux).
#   ./install-bridge.sh            install (asks which browsers)
#   ./install-bridge.sh check      show the state
#   ./install-bridge.sh uninstall  remove
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "Python 3.10 or newer is required. Install it with your package manager or from https://www.python.org/downloads/"
  exit 1
fi
if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  echo "Python 3.10 or newer is required, but $PYTHON is $("$PYTHON" --version 2>&1)." >&2
  echo "Install a newer Python with your package manager or from https://www.python.org/downloads/" >&2
  exit 1
fi
ACTION="${1:-install}"
[ $# -gt 0 ] && shift
exec "$PYTHON" -m ai_subtitles_companion "$ACTION" "$@"
