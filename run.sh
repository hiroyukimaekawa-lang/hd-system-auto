#!/usr/bin/env bash
# ---------------------------------------------------------------------
# HD Scraper Automation の macOS / Linux 用ランチャー。
# Windows 版 run.ps1 とメニュー・機能を揃えてある。
#
#   ./run.sh                                     メニュー表示
#   ./run.sh --task dry --prefecture 茨城県 --area 土浦市 --category 飲食店
#   ./run.sh --task comdesk --spreadsheet-url "https://docs.google.com/..."
#   ./run.sh --task assistant
# ---------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
IMPORTER="$ROOT/comdesk-playwright-importer"
PORT="${HD_ASSISTANT_PORT:-43117}"
URL="http://127.0.0.1:${PORT}"

TASK="menu"
PREFECTURE=""
AREA=""
CATEGORY=""
SPREADSHEET_URL=""
PROJECT_NAME=""
LIST_FILE=""
STOP_ON_ERROR="false"
EXECUTE="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --task)            TASK="${2:-}";            shift 2 ;;
    --prefecture)      PREFECTURE="${2:-}";      shift 2 ;;
    --area)            AREA="${2:-}";            shift 2 ;;
    --category)        CATEGORY="${2:-}";        shift 2 ;;
    --spreadsheet-url) SPREADSHEET_URL="${2:-}"; shift 2 ;;
    --project-name)    PROJECT_NAME="${2:-}";    shift 2 ;;
    --list)            LIST_FILE="${2:-}";       shift 2 ;;
    --stop-on-error)   STOP_ON_ERROR="true";     shift ;;
    --execute)         EXECUTE="true";           shift ;;
    -h|--help)
      echo "使い方: ./run.sh [--task setup|login|dry|run|comdesk|batch|merge|assistant|slack|check]"
      echo "        [--prefecture 茨城県] [--area 土浦市] [--category 飲食店]"
      echo "        [--spreadsheet-url URL] [--project-name 名前]"
      echo "        [--list config/comdesk-batch.txt] [--stop-on-error] [--execute]"
      exit 0 ;;
    *) echo "[run] 不明な引数です: $1" >&2; exit 2 ;;
  esac
done

step() { echo "[run] $*"; }
warn() { echo "[run] $*" >&2; }
err()  { echo "[run] $*" >&2; }

assert_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "Node.js が見つかりません。先にインストールしてください。"
    err "  brew install node   または https://nodejs.org/ja から LTS 版"
    exit 1
  fi
  local version major
  version="$(node -v)"
  major="${version#v}"; major="${major%%.*}"
  if [ "$major" -lt 20 ]; then
    err "Node.js 20 以上が必要です（現在: $version）。"
    exit 1
  fi
  step "Node.js $version を使用します"
}

ask() { # ask <プロンプト> <既定値>
  local prompt="$1" current="${2:-}" value
  if [ -n "$current" ]; then echo "$current"; return; fi
  read -r -p "$prompt: " value < /dev/tty
  echo "$value"
}

confirm() { # confirm <メッセージ>
  local answer
  read -r -p "$1 (y/N): " answer < /dev/tty
  [[ "$answer" =~ ^[yY] ]]
}

# .env の COMDESK_EXECUTE を読む（シェルの環境変数が優先）
comdesk_execute_value() {
  if [ -n "${COMDESK_EXECUTE:-}" ]; then echo "$COMDESK_EXECUTE"; return; fi
  [ -f "$ROOT/.env" ] || return
  grep -E '^[[:space:]]*COMDESK_EXECUTE[[:space:]]*=' "$ROOT/.env" 2>/dev/null |
    tail -1 | sed -E 's/^[^=]*=[[:space:]]*//' | tr -d '"'"'"' ' | tr -d '\r'
}

# 本番投入は --execute と COMDESK_EXECUTE=true の両方が必要。
# .env が false のままなら、この実行だけ true にするか確認する。
ensure_comdesk_execute() {
  local current
  current="$(comdesk_execute_value)"
  [ "$current" = "true" ] && return 0

  warn ".env の COMDESK_EXECUTE が true ではありません（現在: ${current:-未設定}）。"
  warn "コムデスクへの書き込みは、この設定が true の場合だけ行われます。"
  if confirm "この1回だけ COMDESK_EXECUTE=true にして続行しますか？"; then
    export COMDESK_EXECUTE=true
    return 0
  fi
  step "中止しました。恒久的に有効にする場合は .env の COMDESK_EXECUTE=true を編集してください。"
  return 1
}

task_setup() {
  step "初回セットアップを開始します（数分かかることがあります）"

  if [ ! -f "$ROOT/.env" ] && [ -f "$ROOT/.env.example" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    warn ".env を .env.example から作成しました。実行前に中身を編集してください: $ROOT/.env"
  fi

  step "本体の依存パッケージを取得します（npm install）..."
  (cd "$ROOT" && npm install) || return 1

  step "コムデスク投入ツールの依存パッケージを取得します（npm install）..."
  (cd "$IMPORTER" && npm install) || return 1

  step "Playwright用のChromiumを取得します..."
  (cd "$IMPORTER" && npm run install-browser) || return 1

  step "セットアップが完了しました。次は「2) コムデスクにログイン」を実行してください。"
}

task_login() {
  step "コムデスクのログイン画面を開きます。ログイン後、プロジェクト管理画面まで進んでから、このターミナルで Enter を押してください。"
  (cd "$IMPORTER" && node src/login.js)
}

task_pipeline() { # task_pipeline <dry|run>
  local mode="$1" pref area category
  pref="$(ask '都道府県を入力してください（例: 茨城県）' "$PREFECTURE")"
  area="$(ask '市区町村を入力してください（例: 土浦市）' "$AREA")"
  category="$(ask 'ジャンルを入力してください（例: 飲食店）' "$CATEGORY")"

  if [ -z "$pref" ] || [ -z "$area" ] || [ -z "$category" ]; then
    err "都道府県・市区町村・ジャンルはすべて必要です。"
    return 1
  fi

  if [ "$mode" = "run" ]; then
    warn "本番実行です。Googleマップ／食べログの取得と、設定によってはコムデスクへの登録を行います。"
    confirm "実行してよろしいですか？" || { step "中止しました。"; return 0; }
  fi

  node src/orchestrator/cli.js "$mode" "--prefecture=$pref" "--area=$area" "--category=$category"
}

task_comdesk() {
  local url args
  url="$(ask 'GoogleスプレッドシートのURLを貼り付けてください' "$SPREADSHEET_URL")"
  if [ -z "$url" ]; then err "スプレッドシートのURLが必要です。"; return 1; fi

  args=(comdesk-playwright-importer/src/flow.js "--spreadsheet-url=$url")
  [ -n "$PROJECT_NAME" ] && args+=("--project-name=$PROJECT_NAME")

  if [ "$EXECUTE" = "true" ]; then
    warn "本番投入です。コムデスクへ実際に登録されます。"
    confirm "実行してよろしいですか？" || { step "中止しました。"; return 0; }
    ensure_comdesk_execute || return 0
    args+=(--execute)
  else
    step "書き込みなしの確認実行（--dry-run）で実行します。"
    args+=(--dry-run)
  fi

  node "${args[@]}"
}

task_batch() {
  local list args
  list="$(ask 'リストファイルのパスを入力してください（例: config/comdesk-batch.txt）' "$LIST_FILE")"
  if [ -z "$list" ]; then err "リストファイルが必要です。"; return 1; fi
  if [ ! -f "$list" ]; then err "リストファイルが見つかりません: $list"; return 1; fi

  args=(comdesk-playwright-importer/src/batch.js "--list=$list")
  [ "$STOP_ON_ERROR" = "true" ] && args+=(--stop-on-error)

  if [ "$EXECUTE" = "true" ]; then
    warn "本番投入です。リスト内のすべてのシートがコムデスクへ順番に登録されます。"
    confirm "実行してよろしいですか？" || { step "中止しました。"; return 0; }
    ensure_comdesk_execute || return 0
    args+=(--execute)
  else
    step "書き込みなしの確認実行（--dry-run）で実行します。"
    args+=(--dry-run)
  fi

  node "${args[@]}"
}

task_merge() {
  local project args
  project="$(ask 'プロジェクト名を入力してください（例: 茨城県_稲敷市・美浦村）' "$PROJECT_NAME")"
  if [ -z "$project" ]; then err "プロジェクト名が必要です。"; return 1; fi

  args=(src/merge/cli.js --areas=美浦村,稲敷市 --category=飲食店 "--project-name=$project")
  if [ "$EXECUTE" = "true" ]; then
    warn "本番投入です。コムデスクへ実際に登録されます。"
    confirm "実行してよろしいですか？" || { step "中止しました。"; return 0; }
    ensure_comdesk_execute || return 0
    args+=(--execute)
  else
    args+=(--dry-run)
  fi

  node "${args[@]}"
}

assistant_alive() { curl -fsS "$URL/api/health" >/dev/null 2>&1; }

task_assistant() {
  if assistant_alive; then
    step "HD AIアシスタントは起動済みです。ブラウザで開きます: $URL"
  else
    step "HD AIアシスタントを起動します..."
    mkdir -p "$ROOT/state"
    nohup node desktop/server.js >> "$ROOT/state/desktop-assistant.log" 2>> "$ROOT/state/desktop-assistant-error.log" &
    for _ in $(seq 1 20); do
      sleep 0.5
      assistant_alive && break
    done
    if ! assistant_alive; then
      err "起動を確認できませんでした。state/desktop-assistant-error.log を確認してください。"
      return 1
    fi
    step "起動しました: $URL"
  fi

  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  else step "ブラウザで $URL を開いてください。"; fi
}

task_slack() {
  step "Slack常駐アプリを起動します（終了するには Ctrl+C）。"
  node src/slack-app.js
}

task_check() { npm run check; }

show_menu() {
  cat <<'MENU'

=============================================
 HD Scraper Automation
=============================================
 1) 初回セットアップ（最初の1回だけ）
 2) コムデスクにログイン（初回・ログイン切れ時）
 3) 確認実行（書き込みなし / dry-run）
 4) 本番実行
 5) スプレッドシートからコムデスクへ投入（確認）
 6) スプレッドシートからコムデスクへ投入（本番）
 7) 複数スプレッドシートを一括投入（確認）
 8) 複数スプレッドシートを一括投入（本番）
 9) HD AIアシスタントを開く
10) Slack常駐アプリを起動
11) 設定・構文チェック
 0) 終了

MENU
}

assert_node

if [ "$TASK" = "menu" ]; then
  show_menu
  read -r -p "番号を入力してください: " choice < /dev/tty
  case "$choice" in
    1) task_setup ;;
    2) task_login ;;
    3) task_pipeline dry ;;
    4) task_pipeline run ;;
    5) EXECUTE="false"; task_comdesk ;;
    6) EXECUTE="true";  task_comdesk ;;
    7) EXECUTE="false"; task_batch ;;
    8) EXECUTE="true";  task_batch ;;
    9) task_assistant ;;
    10) task_slack ;;
    11) task_check ;;
    0) step "終了します。" ;;
    *) err "0〜11 の番号を入力してください。"; exit 1 ;;
  esac
else
  case "$TASK" in
    setup)     task_setup ;;
    login)     task_login ;;
    dry)       task_pipeline dry ;;
    run)       task_pipeline run ;;
    comdesk)   task_comdesk ;;
    batch)     task_batch ;;
    merge)     task_merge ;;
    assistant) task_assistant ;;
    slack)     task_slack ;;
    check)     task_check ;;
    *) err "不明なタスクです: $TASK"; exit 2 ;;
  esac
fi

status=$?
echo
if [ "$status" -ne 0 ]; then
  err "処理が失敗しました（終了コード $status）。上のメッセージを確認してください。"
else
  step "処理が完了しました。"
fi
exit "$status"
