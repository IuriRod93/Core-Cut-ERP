#!/usr/bin/env bash
# Backup do PostgreSQL + cópia FORA do servidor (S3, Backblaze B2, Google Drive... via rclone).
# Sem isto, perder a VPS significa perder todos os clientes. Faça uma vez:
#
#   1) apt-get install -y rclone
#   2) rclone config            # crie um "remote", ex.: nome "corecut-backup" (B2/S3/Drive)
#      DICA: crie também um remote do tipo "crypt" sobre ele para os arquivos irem criptografados.
#   3) echo 'RCLONE_REMOTE=corecut-backup:corecut-backups' > /opt/corecut/deploy/.backup.env
#   4) cron diário às 03:10 (substitui o cron do backup.sh):
#      (crontab -l 2>/dev/null | grep -v backup; echo "10 3 * * * /bin/bash /opt/corecut/deploy/backup-offsite.sh >> /var/log/corecut-backup.log 2>&1") | crontab -
#
# Mantém 60 dias na nuvem e 14 no servidor.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .backup.env ] && . ./.backup.env
REMOTE="${RCLONE_REMOTE:-}"
[ -n "$REMOTE" ] || { echo "Defina RCLONE_REMOTE em /opt/corecut/deploy/.backup.env (veja as instruções no topo deste arquivo)."; exit 1; }
command -v rclone >/dev/null || { echo "rclone não instalado (apt-get install -y rclone)."; exit 1; }

DEST="${BACKUP_DIR:-/opt/corecut/backups}"
bash ./backup.sh

# envia só os arquivos novos; --immutable impede sobrescrever um backup antigo por engano
rclone copy "$DEST" "$REMOTE" --include "corecut-*.sql.gz" --immutable --transfers 2 --checksum
rclone delete "$REMOTE" --include "corecut-*.sql.gz" --min-age 60d

NEWEST="$(ls -1t "$DEST"/corecut-*.sql.gz | head -1)"
REMOTE_SIZE="$(rclone size "$REMOTE" --include "$(basename "$NEWEST")" --json 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
LOCAL_SIZE="$(stat -c %s "$NEWEST")"
if [ "${REMOTE_SIZE:-0}" != "$LOCAL_SIZE" ]; then
  echo "ERRO: o arquivo na nuvem ($REMOTE_SIZE bytes) difere do local ($LOCAL_SIZE bytes)." >&2
  exit 1
fi
echo "Backup externo OK: $(basename "$NEWEST") ($LOCAL_SIZE bytes) em $REMOTE"
