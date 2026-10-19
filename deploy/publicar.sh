#!/usr/bin/env bash
# Publica / repara o Core Cut NO SERVIDOR: libera as portas 80/443, sobe os containers e testa tudo.
# Pode rodar quantas vezes precisar (é idempotente):
#   bash /opt/corecut/deploy/publicar.sh            # sobe e testa
#   bash /opt/corecut/deploy/publicar.sh --build    # reconstrói a imagem (depois de enviar código novo)
set -uo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✔\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✖\033[0m %s\n' "$*"; PROBLEMS=$((PROBLEMS + 1)); }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }
PROBLEMS=0

say "1/6 Configuração"
if [ ! -f .env ]; then
  bad ".env não existe. Rode: bash gerar-env.sh cutcore.com.br"
  exit 1
fi
DOMAIN="$(grep -E '^DOMAIN=' .env | head -1 | cut -d= -f2-)"
DOMAIN="${DOMAIN:-cutcore.com.br}"
APP_URL="$(grep -E '^APP_URL=' .env | head -1 | cut -d= -f2-)"
ok "domínio: ${DOMAIN}  (principal: www.${DOMAIN})"
ok "APP_URL: ${APP_URL:-<não definida>}"
grep -qE '^MERCADOPAGO_ACCESS_TOKEN=APP_USR-' .env && ok "token do Mercado Pago presente" || warn "token do Mercado Pago ausente ou inválido no .env"

say "2/6 Liberando as portas 80 e 443"
for c in $(docker ps -q); do
  project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$c" 2>/dev/null)"
  if [ "$project" != "corecut" ]; then
    name="$(docker inspect -f '{{.Name}}' "$c" | sed 's#^/##')"
    docker update --restart=no "$c" >/dev/null 2>&1
    docker stop "$c" >/dev/null 2>&1 && ok "container de outro sistema parado: ${name}"
  fi
done
for service in nginx apache2 httpd caddy; do
  if systemctl is-active --quiet "$service" 2>/dev/null; then
    systemctl stop "$service" && systemctl disable "$service" >/dev/null 2>&1
    ok "serviço do servidor parado: ${service}"
  fi
done

say "3/6 Subindo os containers"
if [ "${1:-}" = "--build" ]; then
  echo "  reconstruindo a imagem (leva 1 a 5 minutos)..."
  build_log="$(mktemp)"
  if docker compose build --progress=plain >"$build_log" 2>&1; then
    ok "imagem reconstruída com o código enviado"
    rm -f "$build_log"
  else
    # sem isto o "up" abaixo subiria a imagem ANTIGA e o site pareceria publicado sem estar
    bad "a construção da imagem FALHOU: o site continua na versão anterior"
    echo "  Últimas linhas do erro:"
    tail -n 40 "$build_log" | sed 's/^/    /'
    echo
    echo "  Registro completo em: $build_log"
    printf '\n\033[31mPublicação interrompida.\033[0m Envie as linhas acima para corrigir e rode de novo.\n'
    exit 1
  fi
fi
docker compose up -d 2>&1 | tail -n 12
docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Ports}}' 2>/dev/null || docker compose ps

say "4/6 Aguardando a aplicação ficar saudável"
healthy=0
for _ in $(seq 1 40); do
  state="$(docker inspect -f '{{.State.Health.Status}}' corecut-app-1 2>/dev/null || echo none)"
  if [ "$state" = "healthy" ]; then healthy=1; break; fi
  sleep 3
done
if [ "$healthy" = "1" ]; then ok "aplicação saudável"; else bad "a aplicação não ficou saudável — veja: docker compose logs --tail=40 app"; fi
for service in db app caddy; do
  if docker compose ps --status running --services 2>/dev/null | grep -qx "$service"; then ok "${service}: rodando"; else bad "${service}: NÃO está rodando"; fi
done

say "5/6 Testes locais"
code_http="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "Host: www.${DOMAIN}" http://127.0.0.1/ || true)"
[ "$code_http" = "308" ] || [ "$code_http" = "301" ] || [ "$code_http" = "200" ] && ok "HTTP (porta 80) respondeu ${code_http}" || bad "HTTP (porta 80) respondeu '${code_http}' — o Caddy não está atendendo"
health="$(curl -sk --max-time 15 --resolve "www.${DOMAIN}:443:127.0.0.1" "https://www.${DOMAIN}/api/health" || true)"
if echo "$health" | grep -q '"status":"ok"'; then ok "HTTPS /api/health: ${health}"; else bad "HTTPS /api/health sem resposta (certificado ainda não emitido?)"; fi
for path in / /login /admin /cadastro /app; do
  c="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "www.${DOMAIN}:443:127.0.0.1" "https://www.${DOMAIN}${path}" || true)"
  [ "$c" = "200" ] && ok "https://www.${DOMAIN}${path} → 200" || bad "https://www.${DOMAIN}${path} → ${c}"
done
# o que está de fato no ar: versão do aplicativo e imagens da página inicial
appver="$(curl -sk --max-time 10 --resolve "www.${DOMAIN}:443:127.0.0.1" "https://www.${DOMAIN}/downloads/app-version.json" | grep -o '"versionName": *"[^"]*"' | head -1 | cut -d'"' -f4)"
[ -n "$appver" ] && ok "aplicativo Android publicado: versão ${appver}" || warn "não consegui ler a versão do aplicativo"
c="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "www.${DOMAIN}:443:127.0.0.1" "https://www.${DOMAIN}/site/app/painel.webp" || true)"
[ "$c" = "200" ] && ok "imagens do aplicativo na página inicial → 200" || warn "imagens do aplicativo na página inicial → ${c} (versão antiga no ar?)"
img="$(docker inspect -f '{{.Image}}' corecut-app-1 2>/dev/null || true)"
[ -n "$img" ] && ok "imagem em execução criada em: $(docker image inspect -f '{{.Created}}' "$img" 2>/dev/null | cut -c1-19)"

say "6/6 DNS e certificado"
server_ip="$(curl -4 -s --max-time 8 https://ifconfig.me || echo desconhecido)"
dns_ip="$(getent ahostsv4 "www.${DOMAIN}" | awk 'NR==1{print $1}')"
apex_ip="$(getent ahostsv4 "${DOMAIN}" | awk 'NR==1{print $1}')"
printf '  IP deste servidor : %s\n  www.%s → %s\n  %s → %s\n' "$server_ip" "$DOMAIN" "${dns_ip:-<sem resposta>}" "$DOMAIN" "${apex_ip:-<sem resposta>}"
if [ -n "$dns_ip" ] && [ "$dns_ip" = "$server_ip" ]; then ok "DNS aponta para este servidor"; else bad "DNS de www.${DOMAIN} NÃO aponta para ${server_ip} — corrija o registro A/CNAME no painel do domínio"; fi
echo "  Últimas linhas do certificado (Caddy):"
docker compose logs --tail=300 caddy 2>/dev/null | grep -iE 'certificate obtained|obtaining|challenge|error|failed' | tail -n 6 | sed 's/^/    /'

echo
if [ "$PROBLEMS" = "0" ]; then
  printf '\033[32mTudo certo.\033[0m Abra https://www.%s/admin\n' "$DOMAIN"
else
  printf '\033[31m%s problema(s) acima.\033[0m Corrija o primeiro item marcado com ✖ e rode o script de novo.\n' "$PROBLEMS"
  echo "Se continuar igual, me envie a saída completa deste script (ela é curta)."
fi
