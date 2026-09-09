#!/bin/sh
set -eu

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --restart-audio ]; }; then
    echo "Usage: sudo ./uninstall.sh [--restart-audio]" >&2
    exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo." >&2
    exit 1
fi

destination=/Library/Audio/Plug-Ins/HAL/RoomCable.driver
if [ -L "$destination" ]; then
    echo "Refusing to remove a symlink: $destination" >&2
    exit 1
fi
if [ ! -e "$destination" ]; then
    echo "Room Cable is not installed."
    exit 0
fi
if [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist")" != dev.dubrovin.room.audio ]; then
    echo "Refusing to remove an unrelated driver: $destination" >&2
    exit 1
fi
rm -rf "$destination"
echo "Room Cable removed."
if [ "${1:-}" = --restart-audio ]; then
    killall coreaudiod
else
    echo "Restart your Mac, or run: sudo killall coreaudiod"
fi
