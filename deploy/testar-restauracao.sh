#!/usr/bin/env bash
# Prova que o backup SERVE: restaura o arquivo mais recente em um banco temporário e conta os registros.
# Não toca no banco de produção. Rode depois do primeiro backup e uma vez por mês.
#   cd /opt/corecut/deploy && bash testar-restauracao.sh [arquivo.sql.gz]
set -euo pipefail
cd "$(dirname "$0")"
DEST="${BACKUP_DIR:-/opt/corecut/backups}"
FILE="${1:-$(ls -1t "$DEST"/corecut-*.sql.gz 2>/dev/null | head -1)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Nenhum backup encontrado em $DEST. Rode antes: bash backup.sh"; exit 1; }
echo "Restaurando $FILE em um banco temporário..."

TMPDB="corecut_restore_test"
psql_admin() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U corecut -d postgres "$@"; }
psql_test() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U corecut -d "$TMPDB" "$@"; }

psql_admin -qc "drop database if exists $TMPDB" >/dev/null
psql_admin -qc "create database $TMPDB" >/dev/null
trap 'psql_admin -qc "drop database if exists '"$TMPDB"'" >/dev/null 2>&1 || true' EXIT

gunzip -c "$FILE" | docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U corecut -d "$TMPDB" >/dev/null

echo "Registros restaurados por coleção:"
psql_test -tA -F ' : ' -c "select collection, count(*) from core_cut_documents group by collection order by 2 desc limit 12"
COMPANIES="$(psql_test -tAc "select count(*) from core_cut_documents where collection = 'companies'" | tr -d '[:space:]')"
USERS="$(psql_test -tAc "select count(*) from core_cut_documents where collection = 'users'" | tr -d '[:space:]')"
echo "empresas: $COMPANIES · usuários: $USERS"
[ "${USERS:-0}" -ge 1 ] || { echo "FALHOU: o backup restaurou sem usuários."; exit 1; }
echo "OK: o backup $(basename "$FILE") restaura corretamente."
