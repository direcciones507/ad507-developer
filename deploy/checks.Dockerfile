# Dedicated Docker-capable executor host only; controller secrets are never mounted.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY runtime/sandbox-dependencies.mjs /opt/ad507-link-deps.mjs
COPY runtime/project-check.mjs /opt/ad507-project-check.mjs
RUN mkdir /template && chown node:node /template
# This dependency-free image runs syntax checks and native Node tests only.
# Projects requiring external dependencies need their own reviewed, prebuilt image.
