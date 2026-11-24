#!/bin/bash
set -u
mjai_dir="$(cd "$(dirname "$0")" && pwd -P)"
cd "$mjai_dir" || exit 1
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
    printf '%s\n' 'This package requires an Apple Silicon Mac.'
    read -r -p 'Press Return to close…' _
    exit 1
fi
mjai_macos_version="$(sw_vers -productVersion)"
mjai_macos_major="${mjai_macos_version%%.*}"
case "$mjai_macos_major" in
    ''|*[!0-9]*) printf '%s\n' 'Could not determine the macOS version (14 or newer required).'; read -r -p 'Press Return to close…' _; exit 1 ;;
esac
if [ "$mjai_macos_major" -lt 14 ]; then
    printf '%s\n' "This package needs macOS 14 or newer; this Mac has $mjai_macos_version."
    read -r -p 'Press Return to close…' _
    exit 1
fi
# Prefer the Python distributed with the portable bundle.
if [ -x "$mjai_dir/runtime/python/bin/python3" ]; then
    export PYTHONHOME="$mjai_dir/runtime/python"
    export PYTHONNOUSERSITE=1
    unset PYTHONPATH PYTHONUSERBASE
    exec "$mjai_dir/runtime/python/bin/python3" "$mjai_dir/launcher.py" "$@"
fi
if command -v python3 >/dev/null 2>&1; then
    exec python3 "$mjai_dir/launcher.py" "$@"
fi
printf '%s\n' 'Python 3 is not available. Copy the complete portable folder again.'
read -r -p 'Press Return to close…' _
exit 1
