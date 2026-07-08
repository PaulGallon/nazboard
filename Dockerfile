FROM python:3.12-slim

RUN set -eux; \
    sed -i "s/ main$/ main contrib non-free non-free-firmware/" /etc/apt/sources.list.d/debian.sources; \
    apt-get update; \
    apt-get install -y --no-install-recommends zfsutils-linux; \
    rm -rf /var/lib/apt/lists/*; \
    useradd --system --uid 10001 --create-home --home-dir /nonexistent --shell /usr/sbin/nologin nazboard

WORKDIR /app
COPY app/nazboard.py /app/nazboard.py
RUN chmod 0555 /app/nazboard.py

USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["python", "/app/nazboard.py"]
