#!/bin/sh
set -eu

if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --restart-audio ]; }; then
    echo "Usage: sudo ./install.sh [--restart-audio]" >&2
    exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo after running make as your normal user." >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_bundle="$script_dir/build/RoomCable.driver"
hal=/Library/Audio/Plug-Ins/HAL
destination="$hal/RoomCable.driver"
identifier=dev.dubrovin.room.audio

if [ ! -f "$source_bundle/Contents/MacOS/RoomCable" ]; then
    echo "Build first: make -C $script_dir" >&2
    exit 1
fi
codesign --verify --strict "$source_bundle"
if [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$source_bundle/Contents/Info.plist")" != "$identifier" ]; then
    echo "Unexpected source bundle identifier." >&2
    exit 1
fi
if [ -L "$destination" ]; then
    echo "Refusing to replace a symlink: $destination" >&2
    exit 1
fi
if [ -e "$destination" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist")" != "$identifier" ]; then
    echo "Refusing to replace an unrelated driver: $destination" >&2
    exit 1
fi

mkdir -p "$hal"
staging=$(mktemp -d "$hal/.room-cable-install.XXXXXX")
trap 'rm -rf "$staging"' EXIT
ditto "$source_bundle" "$staging/RoomCable.driver"
chown -R root:wheel "$staging/RoomCable.driver"
chmod -R a+rX,go-w "$staging/RoomCable.driver"
codesign --verify --strict "$staging/RoomCable.driver"

backup=
if [ -e "$destination" ]; then
    backup="$destination.backup-$(date +%Y%m%d-%H%M%S)-$$"
    mv "$destination" "$backup"
fi
if ! mv "$staging/RoomCable.driver" "$destination"; then
    if [ -n "$backup" ]; then mv "$backup" "$destination"; fi
    exit 1
fi
echo "Installed: $destination"
if [ -n "$backup" ]; then echo "Previous bundle: $backup"; fi
if [ "${1:-}" = --restart-audio ]; then
    killall coreaudiod
    echo "Core Audio restarted. Select Room Cable in OBS and your meeting app."
else
    echo "Restart your Mac, or run: sudo killall coreaudiod"
fi
