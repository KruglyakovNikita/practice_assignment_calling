#!/bin/sh
set -eu

corepack pnpm install
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:p0
docker compose up -d --build
corepack pnpm test:p0:integration
