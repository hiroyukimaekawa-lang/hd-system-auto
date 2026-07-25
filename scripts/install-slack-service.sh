#!/bin/zsh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
AGENT="$HOME/Library/LaunchAgents/com.hd.slack.plist"
TMP="$(mktemp)"
for key in SLACK_BOT_TOKEN SLACK_APP_TOKEN SLACK_SIGNING_SECRET SLACK_ALLOWED_CHANNEL_IDS; do
  grep -q "^${key}=." "$ROOT/.env" || { echo "$key が.envに設定されていません"; exit 1; }
done
sed -e "s|__NODE__|$NODE|g" -e "s|__ROOT__|$ROOT|g" "$ROOT/desktop/com.hd.slack.plist.template" > "$TMP"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$TMP" "$AGENT"
launchctl bootout "gui/$(id -u)/com.hd.slack" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
echo "Slack常駐サービスを開始しました"
