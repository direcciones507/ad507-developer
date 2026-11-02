# Reviewed source snapshot, repository-root build context, NEVER the controller image.
# Build on the separate executor host, without API keys, GitHub tokens or production vars.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.15.4
COPY tools/ad507-agent/runtime/sandbox-dependencies.mjs /opt/ad507-link-deps.mjs
COPY tools/ad507-agent/runtime/project-check.mjs /opt/ad507-project-check.mjs
WORKDIR /template
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
# At runtime source overlays /template in a tmpfs; dependencies stay inside this image.
