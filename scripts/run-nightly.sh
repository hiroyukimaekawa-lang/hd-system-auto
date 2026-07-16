#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs
npm start >> "logs/nightly-$(date +%Y%m%d).log" 2>&1
