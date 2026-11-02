# Repository-root context. Controller only: no sandbox daemon and no production secrets.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node tools/ad507-agent/runtime ./tools/ad507-agent/runtime
COPY --chown=node:node tools/ad507-agent/src ./tools/ad507-agent/src
COPY --chown=node:node tools/ad507-agent/deploy/entrypoint.sh ./tools/ad507-agent/deploy/entrypoint.sh
COPY --chown=node:node docs/ad507-technology-agent/projects.json ./docs/ad507-technology-agent/projects.json
RUN mkdir -p /data/ad507 && chown node:node /data/ad507
WORKDIR /app/tools/ad507-agent
ENV AD507_HOST=0.0.0.0 AD507_DATA_DIR=/data/ad507 PORT=8787
EXPOSE 8787
ENTRYPOINT ["sh", "deploy/entrypoint.sh"]
CMD ["node", "runtime/main.mjs"]
