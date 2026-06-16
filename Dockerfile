# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build ----------
# Mirror what ci/publish.ps1 does: compile the per-package JSON, then assemble
# dist/ by copy. twikki's runtime evaluates module strings at boot, so it ships
# unbundled — Vite isn't needed for the production container.
FROM node:lts-alpine AS builder
WORKDIR /app

# package.json is required so the compile script (ESM) is parsed as a module.
# The script imports only node: built-ins, so no npm install is needed.
COPY package.json vite-plugin-tiddler-compile.js ./
COPY src ./src
COPY public ./public

RUN node vite-plugin-tiddler-compile.js

# Assemble dist/ — same layout as ci/publish.ps1 produces.
RUN set -eux; \
    mkdir -p dist/platform dist/modules dist/packages; \
    cp -r public/. dist/; \
    cp src/index.html dist/; \
    cp src/platform/*.js dist/platform/; \
    cp src/modules/*.js dist/modules/

# ---------- Stage 2: runtime ----------
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
