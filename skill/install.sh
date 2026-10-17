#!/bin/sh
# TOA installer (secondary path). The primary is: npx toa-skill
# Usage: curl -fsSL {{TOA_HOST}}/install.sh | sh            (interactive)
#        curl -fsSL {{TOA_HOST}}/install.sh | sh -s -- detect
set -eu
HOST="{{TOA_HOST}}"
if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
  echo "TOA needs Node.js 18+ (for npx). Install it from https://nodejs.org and run this again." >&2
  exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 18 ]; then echo "Node.js $MAJOR is too old; TOA needs 18+." >&2; exit 1; fi
# Prefer the npm package; fall back to the tarball served by this site.
# The site tarball's URL carries the build id, so npx never reuses a cached copy from an older deploy.
PKG="$HOST/toa-skill-{{TOA_BUILD}}.tgz"
# Use npm only for a real release that ships the toa-skill command (not a staged or pre-release placeholder).
NPMV=$(npm view toa-skill version 2>/dev/null || true)
case "$NPMV" in
  ""|*-*) ;;
  *) if [ -n "$(npm view "toa-skill@$NPMV" bin.toa-skill 2>/dev/null || true)" ]; then PKG="toa-skill@$NPMV"; fi ;;
esac
RUN="npx -y --package=$PKG toa-skill"
# Reattach stdin to the terminal so the interactive prompts work when piped from curl.
if [ $# -eq 0 ] && [ -r /dev/tty ]; then exec $RUN --host "$HOST" < /dev/tty; fi
exec $RUN "$@" --host "$HOST"
