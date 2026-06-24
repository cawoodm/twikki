# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build ----------
# Mirror what ci/publish.ps1 does: compile the per-package JSON, then assemble
# dist/ by copy. twikki's runtime evaluates module strings at boot, so it ships
# unbundled — Vite isn't needed for the production container.
FROM node:lts-alpine AS builder
WORKDIR /app

# The compile script imports only node: built-ins, but we DO need workbox-cli to
# generate the offline service worker. Install just that one tool (pinned to the
# devDependencies range) into this throwaway builder stage — kept in its own
# layer before the source copies so it caches across source changes.
RUN npm install --no-save --no-audit --no-fund workbox-cli@7.4.1

# package.json is required so the compile script (ESM) is parsed as a module.
COPY package.json vite-plugin-tiddler-compile.js workbox-config.cjs ./
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

# Generate the service worker LAST, over the fully-assembled dist/, so the
# precache covers the complete shell (platform + modules) and the compiled
# data layer (mirrors ci/publish.ps1). workbox-config.cjs uses relative URLs,
# so the same sw.js works whether the image is served at / or a sub-path.
RUN npx workbox-cli generateSW workbox-config.cjs

# ---------- Stage 2: runtime ----------
# twikki always runs under /twikki/ (the manifest, service-worker fallback and
# published GitHub Pages base all use that absolute path), so serve the build
# from html/twikki/ and redirect the bare root there.
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html/twikki
COPY ci/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
