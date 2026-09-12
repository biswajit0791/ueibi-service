#!/usr/bin/env bash
# ==============================================================================
# Script: clean-usifdn.sh
# Purpose: Purge usifdn.org tenant, registration, and users on GCP server
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "===================================================="
echo "🚀 Running USIFDN cleanup script on GCP server..."
echo "===================================================="

node clean-usifdn.js

echo "===================================================="
echo "✅ Done! You can now re-register usifdn.org cleanly."
echo "===================================================="
