#!/bin/sh
# Vercel "Ignored Build Step" for the signal-bot project. Exit 0 skips the
# build, exit 1 builds. Every build pushes a new daemon image to the container
# registry, so only build production (main) when a file the image uses changed.
# Preview deployments never run daemons, so they are always skipped.

if [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then
  echo "Skipping: preview deployments don't run the daemon."
  exit 0
fi

base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "Building: previous deployment commit not available."
  exit 1
fi

if git diff --quiet "$base" HEAD -- \
  vercel.json Dockerfile.signal-bot tsconfig.json \
  deploy/signal-bot lib/signals.ts lib/signal-delivery.ts scripts/signal-bot.ts; then
  echo "Skipping: no signal-bot changes since $base."
  exit 0
fi

echo "Building: signal-bot files changed."
exit 1
