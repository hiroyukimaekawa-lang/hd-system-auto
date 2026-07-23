#!/usr/bin/env bash
set -euo pipefail

repository="${HD_SYSTEM_AUTO_ROOT:-/Users/maekawahiroyuki/hd-system-auto}"
action="${1:-}"
if [[ -z "$action" ]]; then
  echo "usage: run.sh <import-sheet|scrape|resume|finalize|status> [options]" >&2
  exit 2
fi
shift

execute=false
dry_run=false
arguments=()
for value in "$@"; do
  case "$value" in
    --execute) execute=true ;;
    --dry-run) dry_run=true ;;
    *) arguments+=("$value") ;;
  esac
done

cd "$repository"
case "$action" in
  import-sheet)
    if [[ "$execute" == true ]]; then
      npm run comdesk:auto -- "${arguments[@]}" --execute
    else
      npm run comdesk:auto:dry -- "${arguments[@]}"
    fi
    ;;
  scrape)
    if [[ "$execute" == true ]]; then
      env COMDESK_EXECUTE=true npm run hd:run -- "${arguments[@]}"
    else
      npm run hd:dry -- "${arguments[@]}"
    fi
    ;;
  resume)
    if [[ "$execute" != true ]]; then echo "resume requires --execute" >&2; exit 2; fi
    env COMDESK_EXECUTE=true npm run hd:resume -- "${arguments[@]}"
    ;;
  finalize)
    if [[ "$execute" != true ]]; then echo "finalize requires --execute" >&2; exit 2; fi
    env COMDESK_EXECUTE=true npm run hd:finalize -- "${arguments[@]}"
    ;;
  status)
    node comdesk-playwright-importer/src/inspect-import-status.js "${arguments[@]}"
    ;;
  *)
    echo "unknown action: $action" >&2
    exit 2
    ;;
esac
