# Independent repository root. No LeveIA build context or npm workspace required.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates gosu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node runtime ./runtime
COPY --chown=node:node src ./src
COPY --chown=node:node config ./config
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node deploy/entrypoint.sh ./deploy/entrypoint.sh
RUN mkdir -p /data/ad507 && chown node:node /data/ad507
ENV AD507_HOST=0.0.0.0 AD507_DATA_DIR=/data/ad507 PORT=8787 AD507_LIVE_ENABLED=false AD507_CHECK_BACKEND=local-docker
EXPOSE 8787
ENTRYPOINT ["sh", "deploy/entrypoint.sh"]
CMD ["node", "runtime/main.mjs"]
