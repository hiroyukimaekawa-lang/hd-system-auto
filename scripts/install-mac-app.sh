#!/bin/zsh
set -eu
ROOT="/Users/maekawahiroyuki/hd-system-auto"
APP="$HOME/Desktop/HD AIアシスタント.app"
NODE="$(command -v node)"
TMP="$(mktemp -d)"
AGENT="$HOME/Library/LaunchAgents/com.hd.assistant.plist"
sed -e "s|__NODE__|$NODE|g" -e "s|__ROOT__|$ROOT|g" "$ROOT/desktop/launcher.applescript" > "$TMP/launcher.applescript"
sed -e "s|__NODE__|$NODE|g" -e "s|__ROOT__|$ROOT|g" "$ROOT/desktop/com.hd.assistant.plist.template" > "$TMP/com.hd.assistant.plist"
osacompile -o "$APP" "$TMP/launcher.applescript"
mkdir -p "$APP/Contents/Resources"
cp "$ROOT/desktop/assets/assistant-icon.png" "$APP/Contents/Resources/assistant-icon.png"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile assistant-icon.png" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$APP/Contents/Info.plist" 2>/dev/null || true
codesign --force --deep --sign - "$APP"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$TMP/com.hd.assistant.plist" "$AGENT"
launchctl bootout "gui/$(id -u)/com.hd.assistant" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
touch "$APP"
echo "$APP"
