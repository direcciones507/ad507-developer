# Ephemeral CI only: no repository source or secrets are included in this image.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir /template && chown node:node /template

COPY sandbox-dependencies.mjs /opt/ad507-link-deps.mjs
