#!/usr/bin/env bash
# Ubuntu 24.04 (Noble) — install Chromium for Puppeteer / print-policy PDFs.
# Run on the server: bash scripts/install-chromium-ubuntu-noble.sh
# Then: pm2 restart nowShipping --update-env
set -euo pipefail
sudo apt-get update
if ! sudo apt-get install -y chromium; then
  echo "Package chromium failed; trying chromium-browser..." >&2
  sudo apt-get install -y chromium-browser
fi
echo "Installed. Chromium binary:"
command -v chromium || command -v chromium-browser || true
ls -la /usr/bin/chromium* 2>/dev/null || true
echo "Restart your Node process (e.g. pm2 restart nowShipping)."
