#!/usr/bin/env bash
# Resumo de saúde do Core Cut no servidor: containers, API, erros recentes, disco e memória.
# Uso (na pasta /opt/corecut/deploy):   bash diagnostico.sh        # últimas 24 h
#                                       bash diagnostico.sh 72h    # outra janela
# Cole a saída inteira na conversa para análise. Nenhuma senha ou chave é impressa.
set -uo pipefail
cd "$(dirname "$0")"
SINCE="${1:-24h}"
dc() { docker compose "$@"; }

section() { printf '\n==== %s ====\n' "$1"; }

section "Containers"
dc ps

section "Saúde da API (dentro do container)"
dc exec -T app node -e "fetch('http://127.0.0.1:4400/api/health').then(async (r)=>{console.log(r.status, await r.text())}).catch((e)=>{console.log('FALHOU', e.message);process.exit(1)})" || echo "API não respondeu"

section "Reinicializações e uso do container app"
docker inspect --format 'iniciado={{.State.StartedAt}} reinicios={{.RestartCount}} status={{.State.Status}} saida={{.State.ExitCode}} oom={{.State.OOMKilled}}' "$(dc ps -q app)" 2>/dev/null || echo "sem dados"
docker stats --no-stream --format 'cpu={{.CPUPerc}} memoria={{.MemUsage}} ({{.MemPerc}})' "$(dc ps -q app)" 2>/dev/null || true

section "Erros internos do servidor (HTTP 500, falhas fatais) — janela $SINCE"
dc logs --since "$SINCE" --no-color app 2>&1 | grep -E "\[erro\]|\[fatal\]|\[db\]|Error|ECONN|ETIMEDOUT|out of memory" | sort | uniq -c | sort -rn | head -25 || true

section "Telas que quebraram no navegador dos usuários — janela $SINCE"
dc logs --since "$SINCE" --no-color app 2>&1 | grep -E "\[navegador\]" | sed -E 's/^[^|]*\| *//' | sort | uniq -c | sort -rn | head -25 || true

section "Últimas 40 linhas do app"
dc logs --tail=40 --no-color app 2>&1 | cut -c1-240

section "Proxy (Caddy): erros e certificados — janela $SINCE"
dc logs --since "$SINCE" --no-color caddy 2>&1 | grep -iE "error|warn|certificate|tls" | tail -15 | cut -c1-240 || true

section "Banco de dados"
dc exec -T db pg_isready -U corecut -d corecut || true
dc exec -T db psql -U corecut -d corecut -tAc "select 'tamanho do banco: ' || pg_size_pretty(pg_database_size('corecut'))" 2>/dev/null || true

section "Disco e memória do servidor"
df -h / /opt 2>/dev/null | awk 'NR==1 || !seen[$1]++'
free -h
echo "carga: $(cut -d' ' -f1-3 /proc/loadavg)"
ls -1t /opt/corecut/backups/corecut-*.sql.gz 2>/dev/null | head -3 | sed 's/^/backup: /' || true
[ -z "$(ls /opt/corecut/backups/corecut-*.sql.gz 2>/dev/null)" ] && echo "ATENÇÃO: nenhum backup encontrado em /opt/corecut/backups"

section "Fim"
echo "Painel Admin → Monitoramento mostra os mesmos erros em tempo real (https://www.cutcore.com.br/admin)."
