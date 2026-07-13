FROM node:22-bookworm-slim AS build

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim

RUN set -eux; \
    sed -i "s/ main$/ main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends zfsutils-linux; \
    rm -rf /var/lib/apt/lists/*; \
    useradd --system --uid 10001 --create-home --home-dir /nonexistent --shell /usr/sbin/nologin nazboard

WORKDIR /app
COPY --from=build /src/build/server /app/build/server
COPY --from=build /src/dist /app/dist
COPY package.json /app/package.json

USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["node", "/app/build/server/nazboard.js"]
