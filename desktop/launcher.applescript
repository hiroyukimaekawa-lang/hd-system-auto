on run
  try
    do shell script "curl -fsS http://127.0.0.1:43117/api/health >/dev/null 2>&1"
  on error
    do shell script "launchctl kickstart -k gui/$(id -u)/com.hd.assistant"
    delay 1
  end try
  do shell script "open http://127.0.0.1:43117"
end run
