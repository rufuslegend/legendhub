FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends cron default-mysql-client gzip \
    && rm -rf /var/lib/apt/lists/*

COPY cron-mysql /etc/cron.d/cron-mysql

COPY backup-entrypoint /usr/local/bin/backup-entrypoint
COPY backup-mysql /usr/local/bin/backup-mysql

RUN chmod 0644 /etc/cron.d/cron-mysql \
    && chmod +x /usr/local/bin/backup-entrypoint \
        /usr/local/bin/backup-mysql \
    && mkdir -p /backups/private /backups/public

ENTRYPOINT ["/usr/local/bin/backup-entrypoint"]
CMD ["cron", "-f", "-L", "15"]
