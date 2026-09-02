FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS build

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:26-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341

RUN set -eux; \
    sed -i "s/ main$/ main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends libcap2-bin smartmontools util-linux zfsutils-linux; \
    setcap cap_dac_override,cap_sys_admin,cap_sys_rawio=ep /usr/sbin/smartctl; \
    rm -rf /var/lib/apt/lists/*; \
    groupadd --gid 10001 nazboard; \
    useradd --uid 10001 --gid nazboard --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin nazboard; \
    usermod --append --groups disk nazboard

WORKDIR /app
COPY --from=build /src/build/server /app/build/server
COPY --from=build /src/dist /app/dist
COPY package.json /app/package.json

ENV NODE_ENV=production
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '8080') + '/healthz').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
ENTRYPOINT ["node", "/app/build/server/nazboard.js"]
