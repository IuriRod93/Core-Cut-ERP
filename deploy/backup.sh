#!/usr/bin/env bash
# Backup diário do PostgreSQL do Core Cut (mantém os 14 mais recentes).
# Instalar no cron do servidor (todo dia às 03:00):
#   (crontab -l 2>/dev/null; echo "0 3 * * * /bin/bash /opt/corecut/deploy/backup.sh") | crontab -
# Restaurar:
#   gunzip -c /opt/corecut/backups/corecut-AAAA-MM-DD.sql.gz | docker compose -f /opt/corecut/deploy/docker-compose.yml exec -T db psql -U corecut corecut
set -euo pipefail
DEST="${BACKUP_DIR:-/opt/corecut/backups}"
mkdir -p "$DEST"
FILE="$DEST/corecut-$(date +%F).sql.gz"
docker compose -f /opt/corecut/deploy/docker-compose.yml exec -T db pg_dump -U corecut --no-owner corecut | gzip > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"
ls -1t "$DEST"/corecut-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "Backup gravado em $FILE ($(du -h "$FILE" | cut -f1))"
