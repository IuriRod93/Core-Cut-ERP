#!/usr/bin/env bash
# Redefine a senha do administrador da plataforma (admin@corecut.local) — NO SERVIDOR.
# Use se a senha foi esquecida ou se o login deixou de funcionar. A troca será exigida no próximo login.
#   cd /opt/corecut/deploy && bash reset-admin.sh 'NovaSenhaForte123'
#   bash reset-admin.sh 'NovaSenhaForte123' outro@email.com     (outro usuário da plataforma)
# Ao final o script TESTA o login de verdade e diz se funcionou.
set -euo pipefail
cd "$(dirname "$0")"
NEW="${1:-}"
EMAIL="${2:-admin@corecut.local}"
[ "${#NEW}" -ge 8 ] || { echo "Informe a nova senha (mínimo 8 caracteres): bash reset-admin.sh 'NovaSenhaForte123'"; exit 1; }

echo "== 1/3 Redefinindo a senha de $EMAIL"
docker compose exec -T -e NEW_PASSWORD="$NEW" -e TARGET_EMAIL="$EMAIL" app node --input-type=module <<'JS'
import pg from 'pg'
import { hashPassword } from './backend/lib/auth.mjs'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const email = String(process.env.TARGET_EMAIL).trim().toLowerCase()
const hash = hashPassword(process.env.NEW_PASSWORD)
const r = await pool.query(
  `update core_cut_documents
      set document = (document - 'totpSecret' - 'totpPendingSecret' - 'recoveryCodes')
        || jsonb_build_object('passwordHash', $1::text, 'passwordMustChange', true, 'active', true, 'totpEnabled', false)
    where collection = 'users' and lower(document->>'email') = $2`,
  [hash, email],
)
console.log('usuários atualizados:', r.rowCount)
if (r.rowCount === 0) {
  const all = await pool.query(`select document->>'email' as email, document->>'role' as role, coalesce(document->>'companyId', '(plataforma)') as empresa from core_cut_documents where collection = 'users' order by 1`)
  console.log('Nenhum usuário com esse e-mail. Usuários existentes:')
  for (const row of all.rows) console.log(' -', row.email, '·', row.role, '·', row.empresa)
  await pool.end()
  process.exit(3)
}
await pool.end()
JS

echo "== 2/3 Reiniciando o app (a API guarda os dados em memória)"
docker compose restart app >/dev/null
for i in $(seq 1 40); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:4400/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "== 3/3 Testando o login"
docker compose exec -T -e NEW_PASSWORD="$NEW" -e TARGET_EMAIL="$EMAIL" app node --input-type=module <<'JS'
const res = await fetch('http://127.0.0.1:4400/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: process.env.TARGET_EMAIL, password: process.env.NEW_PASSWORD }),
})
const body = await res.json().catch(() => ({}))
if (res.ok && body.token) {
  console.log('LOGIN OK — usuário:', body.user?.email, '· troca de senha exigida:', Boolean(body.user?.passwordMustChange))
} else {
  console.log('LOGIN FALHOU — HTTP', res.status, JSON.stringify(body))
  process.exit(4)
}
JS
echo
echo "Pronto. Entre em https://www.cutcore.com.br/login com $EMAIL e a nova senha (a troca será exigida)."
