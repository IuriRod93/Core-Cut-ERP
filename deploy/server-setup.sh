#!/usr/bin/env bash
# Prepara um Ubuntu 24.04 limpo para rodar o Core Cut ERP: Docker, firewall, proteção contra
# força bruta no SSH, atualizações de segurança automáticas e a pasta /opt/corecut.
# Executar NO SERVIDOR, como root:  bash server-setup.sh
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "Execute como root."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl ufw openssl fail2ban unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Firewall: SSH + web. O PostgreSQL não é exposto.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# fail2ban: bloqueia por 1 hora quem errar a senha do SSH 5 vezes em 10 minutos.
cat > /etc/fail2ban/jail.d/corecut.local <<'EOF'
[sshd]
enabled  = true
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# atualizações de segurança automáticas
dpkg-reconfigure -f noninteractive unattended-upgrades || true

mkdir -p /opt/corecut
echo
echo "Docker: $(docker --version)"
echo "fail2ban: $(systemctl is-active fail2ban)"
echo "Pronto. Envie o projeto para /opt/corecut (veja deploy/LEIAME.md) e rode: bash deploy/gerar-env.sh"
