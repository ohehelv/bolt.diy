#!/bin/sh
set -eu

pnpm run dockerstart &
bolt_pid=$!

cleanup() {
  kill "$bolt_pid" 2>/dev/null || true
  wait "$bolt_pid" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

node scripts/auth-proxy.mjs
