#!/usr/bin/env bash
# Gera o .env de produção NO SERVIDOR (senhas aleatórias; o token do Mercado Pago é digitado
# aqui, sem aparecer na tela, para nunca trafegar em chat ou arquivo versionado).
#   cd /opt/corecut/deploy && bash gerar-env.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { echo ".env já existe. Apague-o (rm .env) se quiser gerar de novo."; exit 1; }

DOMAIN="${1:-cutcore.com.br}"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
FISCAL_SECRET_KEY="$(openssl rand -hex 32)"

read -r -s -p "Access Token do Mercado Pago (APP_USR-...): " MP_TOKEN; echo
read -r -s -p "Assinatura secreta do webhook (Enter para configurar depois): " MP_SECRET; echo
read -r -p "Servidor SMTP para e-mails (ex.: smtp.hostinger.com; Enter para configurar depois): " SMTP_HOST
SMTP_USER=""; SMTP_PASS=""
if [ -n "$SMTP_HOST" ]; then
  read -r -p "E-mail de envio (ex.: contato@${DOMAIN}): " SMTP_USER
  read -r -s -p "Senha desse e-mail: " SMTP_PASS; echo
fi

umask 077
cat > .env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DOMAIN=${DOMAIN}
APP_URL=https://www.${DOMAIN}
ARCOPLAN_ADMIN_PASSWORD=${ADMIN_PASSWORD}
MERCADOPAGO_ACCESS_TOKEN=${MP_TOKEN}
MERCADOPAGO_WEBHOOK_SECRET=${MP_SECRET}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
MAIL_FROM=Core Cut <${SMTP_USER:-contato@${DOMAIN}}>
# chave que cifra o token do provedor fiscal (NF-e). Não perca: sem ela os tokens salvos precisam ser digitados de novo.
FISCAL_SECRET_KEY=${FISCAL_SECRET_KEY}
EOF

echo
echo ".env criado (permissão 600)."
echo "Login inicial do administrador da plataforma:"
echo "   usuário: admin@corecut.local"
echo "   senha:   ${ADMIN_PASSWORD}   (a troca é exigida no primeiro acesso — anote agora)"
