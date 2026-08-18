FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends cron default-mysql-client gzip \
        openssh-client python3 python3-pymysql \
    && rm -rf /var/lib/apt/lists/*

COPY cron-mysql /etc/cron.d/cron-mysql
COPY content_sync /usr/local/lib/content_sync

COPY backup-entrypoint /usr/local/bin/backup-entrypoint
COPY backup-mysql /usr/local/bin/backup-mysql
COPY export-public-content sync-public-content content-sync-health /usr/local/bin/

RUN chmod 0644 /etc/cron.d/cron-mysql \
    && chmod +x /usr/local/bin/backup-entrypoint \
        /usr/local/bin/backup-mysql \
        /usr/local/bin/export-public-content \
        /usr/local/bin/sync-public-content \
        /usr/local/bin/content-sync-health \
    && mkdir -p /backups/private /backups/public

ENTRYPOINT ["/usr/local/bin/backup-entrypoint"]
CMD ["cron", "-f", "-L", "15"]
