#!/usr/bin/env bash
# Deploy Pixel Arc Labs to Cloudflare Pages
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build
npx wrangler pages deploy dist --project-name pixelarclabs --commit-dirty=true
echo "Live: https://pixelarclabs.pages.dev"
echo "After DNS: https://pixelarclabs.com"
