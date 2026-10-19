#!/usr/bin/env bash
# Endurece o SSH da VPS: só entra com chave (desliga senha) e limita tentativas.
# Roda NO SERVIDOR, como root. Ele se recusa a continuar se não houver chave cadastrada,
# para você não se trancar para fora.
#
# Passo a passo (do seu computador Windows):
#   1) ssh-keygen -t ed25519 -C "corecut-vps"            (aceite o caminho padrão)
#   2) type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@85.209.92.9 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
#   3) Abra OUTRO terminal e confirme que entra SEM pedir senha: ssh root@85.209.92.9
#   4) Só então, no servidor: bash /opt/corecut/deploy/seguranca-ssh.sh
#   5) Mantenha a sessão atual aberta e teste um novo login antes de fechá-la.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root."; exit 1; }

KEYS=0
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] && KEYS=$((KEYS + $(grep -cE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2)' "$f" || true)))
done
if [ "$KEYS" -lt 1 ]; then
  echo "RECUSADO: nenhuma chave SSH cadastrada em authorized_keys. Siga o passo a passo no topo deste arquivo."
  exit 1
fi
echo "Chaves SSH encontradas: $KEYS"

CONF=/etc/ssh/sshd_config.d/99-corecut.conf
mkdir -p /etc/ssh/sshd_config.d
cat > "$CONF" <<'EOF'
# Core Cut — endurecimento do SSH
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
if ! sshd -t; then
  rm -f "$CONF"
  echo "Configuração inválida; nada foi alterado."
  exit 1
fi
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "SSH endurecido. Abra um NOVO terminal e confirme o acesso por chave antes de fechar esta sessão."
echo "Para desfazer: rm $CONF && systemctl reload ssh"
