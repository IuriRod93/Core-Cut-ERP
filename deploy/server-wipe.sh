#!/usr/bin/env bash
# LIMPEZA DO SERVIDOR — executar NO SERVIDOR, como root.
#
# Apaga TODOS os containers, imagens, volumes e redes do Docker e as pastas de projeto em /opt.
# Antes de apagar, mostra o que existe, exige que você digite a confirmação e (por padrão)
# faz um backup em /root. Para um servidor realmente zerado, prefira reinstalar o sistema
# operacional pelo painel da hospedagem.
#
#   bash server-wipe.sh               # com backup (recomendado)
#   bash server-wipe.sh --sem-backup  # sem backup
set -euo pipefail

[ "$(id -u)" = "0" ] || { echo "Execute como root."; exit 1; }
BACKUP=1
[ "${1:-}" = "--sem-backup" ] && BACKUP=0

PUBLIC_IP="$(curl -fsS -4 --max-time 8 https://ifconfig.me 2>/dev/null || echo desconhecido)"
echo "=============================================================="
echo " Servidor : $(hostname)"
echo " IP público: ${PUBLIC_IP}   <-- confira se é o IP que você quer limpar"
echo "=============================================================="
echo
echo "== Containers Docker"
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || echo "(Docker não instalado)"
echo
echo "== Volumes Docker"
docker volume ls 2>/dev/null || true
echo
echo "== Conteúdo de /opt"
ls -la /opt
echo
echo "== Serviços em execução (fora do sistema base)"
systemctl list-units --type=service --state=running --no-legend 2>/dev/null | grep -Ev 'ssh|systemd|dbus|cron|rsyslog|networkd|resolved|getty|polkit|multipathd|unattended|snapd|udisks|ModemManager|qemu|irqbalance|chrony|ntp|cloud-init|packagekit|serial' || true
echo
echo "ISTO VAI APAGAR TUDO ACIMA (containers, imagens, volumes e /opt), de forma IRREVERSÍVEL."
read -r -p "Para continuar digite exatamente: APAGAR TUDO  > " answer
[ "$answer" = "APAGAR TUDO" ] || { echo "Cancelado. Nada foi alterado."; exit 1; }

if [ "$BACKUP" = "1" ]; then
  STAMP="$(date +%Y%m%d-%H%M)"
  DEST="/root/backup-antes-da-limpeza-${STAMP}"
  mkdir -p "${DEST}/volumes"
  echo "== Backup em ${DEST}"
  tar -czf "${DEST}/opt.tar.gz" -C / opt 2>/dev/null || true
  [ -d /etc/caddy ] && tar -czf "${DEST}/etc-caddy.tar.gz" -C / etc/caddy 2>/dev/null || true
  if command -v docker >/dev/null 2>&1; then
    for volume in $(docker volume ls -q); do
      docker run --rm -v "${volume}:/v:ro" -v "${DEST}/volumes:/b" alpine tar -czf "/b/${volume}.tgz" -C /v . 2>/dev/null \
        && echo "   volume ${volume} salvo" || echo "   (não foi possível salvar o volume ${volume})"
    done
  fi
  echo "Backup concluído. Copie para fora do servidor antes de reinstalar: scp -r root@${PUBLIC_IP}:${DEST} ."
fi

echo "== Apagando"
if command -v docker >/dev/null 2>&1; then
  docker ps -aq | xargs -r docker rm -f
  docker system prune -a --volumes -f
fi
find /opt -mindepth 1 -maxdepth 1 ! -name containerd -exec rm -rf {} +
rm -rf /root/.pm2 2>/dev/null || true

echo
echo "Pronto. Servidor limpo (o sistema operacional foi mantido)."
echo "Próximo passo: bash server-setup.sh"
