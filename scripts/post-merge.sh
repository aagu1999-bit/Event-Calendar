#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Reconcile installed packages with the merged lockfile, including build tools.
npm ci --include=dev --no-audit --no-fund

# Validate before the platform restarts the application workflows.
npm run check