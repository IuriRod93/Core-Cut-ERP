#!/usr/bin/env bash
# Empacota e envia o Core Cut para /opt/corecut. Execute a partir de qualquer diretório:
#   bash deploy/enviar.sh 85.209.92.9
#   bash deploy/enviar.sh 85.209.92.9 --subir
set -euo pipefail

SERVER="${1:?Uso: bash deploy/enviar.sh IP_DO_SERVIDOR [--subir]}"
MODE="${2:---enviar}"
if [[ "$MODE" != "--enviar" && "$MODE" != "--subir" ]]; then
  echo "Opção inválida: $MODE (use --enviar ou --subir)" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/corecut-deploy.XXXXXX.tar.gz")"
trap 'rm -f "$ARCHIVE"' EXIT

tar -czf "$ARCHIVE" -C "$ROOT" \
  --exclude=node_modules --exclude=dist --exclude=backend/data --exclude=release --exclude=marketing \
  --exclude=CoreCut-App/node_modules --exclude=CoreCut-App/.expo --exclude=CoreCut-App/.git \
  --exclude=CoreCut-App/build --exclude=CoreCut-App/android/.gradle --exclude=CoreCut-App/android/app/build \
  --exclude=CoreCut-App/gradle-build.log \
  --exclude=.git --exclude=.claude --exclude=.playwright-mcp --exclude=.env --exclude='.env.*' \
  --exclude=deploy/.env --exclude='*.log' --exclude='*.tsbuildinfo' .

echo "Enviando o pacote para root@$SERVER..."
scp "$ARCHIVE" "root@$SERVER:/tmp/corecut-deploy.tar.gz"

if [[ "$MODE" == "--subir" ]]; then
  ssh "root@$SERVER" 'set -e
    mkdir -p /opt/corecut
    tar -xzf /tmp/corecut-deploy.tar.gz -C /opt/corecut
    rm -f /tmp/corecut-deploy.tar.gz
    test -f /opt/corecut/deploy/.env || { echo "Falta /opt/corecut/deploy/.env; arquivos enviados, build não iniciado." >&2; exit 1; }
    cd /opt/corecut/deploy
    docker compose up -d --build
    docker compose ps'
else
  ssh "root@$SERVER" 'set -e
    mkdir -p /opt/corecut
    tar -xzf /tmp/corecut-deploy.tar.gz -C /opt/corecut
    rm -f /tmp/corecut-deploy.tar.gz
    echo "Arquivos enviados para /opt/corecut; containers não foram reiniciados."'
fi
