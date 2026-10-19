# Checklist de produção — Core Cut ERP

Marque cada item. Os blocos 1 a 4 são feitos uma única vez; o bloco 5 é rotina.

## 1. Publicar esta versão
```powershell
# no seu computador (Windows)
.\deploy\enviar.ps1 -Servidor 85.209.92.9
```
```bash
# no servidor
cd /opt/corecut/deploy && bash publicar.sh --build
bash diagnostico.sh
```
- [ ] `diagnostico.sh` sem `[erro]`/`[fatal]` e com a API respondendo.
- [ ] https://www.cutcore.com.br/api/health responde `"status":"ok"`.

## 2. Trocar as credenciais que apareceram em conversas
Considere comprometido tudo que foi colado em chats, prints ou e-mails.

| O quê | Como trocar |
|---|---|
| **Mercado Pago** (Access Token, Public Key, Client Secret) | Mercado Pago → *Suas integrações* → sua aplicação → *Credenciais de produção* → **renovar**. Depois edite `/opt/corecut/deploy/.env` (`MERCADOPAGO_ACCESS_TOKEN`) e rode `docker compose up -d app`. |
| **Segredo do webhook** | Mercado Pago → *Webhooks* → **gerar nova assinatura secreta**; atualize `MERCADOPAGO_WEBHOOK_SECRET` no `.env`. |
| **Senha do administrador** | `cd /opt/corecut/deploy && bash reset-admin.sh 'NovaSenhaForte123'` e troque no primeiro login. |
| **Senha do PostgreSQL** | `docker compose exec db psql -U corecut -c "alter user corecut password 'NOVA'"`; atualize `POSTGRES_PASSWORD` **e** a `DATABASE_URL` no `.env`; `docker compose up -d`. |
| **Senha do servidor (root)** | Use `seguranca-ssh.sh` (bloco 3) e troque com `passwd`. |

- [ ] Token do Mercado Pago renovado e `.env` atualizado
- [ ] Segredo do webhook renovado
- [ ] Senha do admin trocada
- [ ] Senha do banco trocada

## 3. Acesso ao servidor
- [ ] Chave SSH criada e testada (passo a passo no topo de `deploy/seguranca-ssh.sh`)
- [ ] `bash seguranca-ssh.sh` executado; novo login por chave confirmado
- [ ] Firewall ativo: `ufw status` mostra só 22, 80 e 443 (o `server-setup.sh` já configura)

## 4. Backup que sobrevive à perda do servidor
- [ ] Remote do rclone criado (`rclone config`) e `.backup.env` preenchido
- [ ] Cron diário do `backup-offsite.sh` instalado
- [ ] `bash backup-offsite.sh` rodou sem erro e o arquivo aparece na nuvem
- [ ] **`bash testar-restauracao.sh` terminou com "OK"** — backup que nunca foi restaurado não conta

## 4b. E-mail (recuperação de senha e avisos de cobrança)
Crie a caixa `contato@cutcore.com.br` no seu provedor (Hostinger → E-mails) e acrescente ao `.env` do servidor:
```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=contato@cutcore.com.br
SMTP_PASS=a-senha-da-caixa
MAIL_FROM=Core Cut <contato@cutcore.com.br>
```
Depois `docker compose up -d app` e, em **Painel Admin → Monitoramento → E-mail (SMTP)**, use *Enviar e-mail de teste*.
- [ ] Caixa criada e variáveis no `.env`
- [ ] E-mail de teste recebido
- [ ] "Esqueci minha senha" testado com uma conta de verdade

## 5. Rotina
- **Todo dia:** olhar *Painel Admin → Monitoramento* (erros do servidor e do navegador).
- **Toda semana:** `bash diagnostico.sh 168h`.
- **Todo mês:** `bash testar-restauracao.sh` e `apt-get update && apt-get -y upgrade` (o `unattended-upgrades` cuida só dos patches de segurança).

## 6. Alerta quando o site cair (grátis)
1. Crie conta no UptimeRobot (uptimerobot.com).
2. *Add New Monitor* → tipo **HTTP(s) – Keyword**.
3. URL: `https://www.cutcore.com.br/api/health` · palavra-chave: `"status":"ok"` · intervalo: 5 min.
4. Em *Alert Contacts* adicione seu e-mail (e WhatsApp via Telegram/Callmebot, se quiser).
5. Opcional: segundo monitor em `https://www.cutcore.com.br/` para a página inicial.

## 7. Pagamento real, ponta a ponta
1. Entre em https://www.cutcore.com.br/admin → **Teste de cobrança**.
2. Gere o PIX de R$ 1,00 e pague com o seu app do banco.
3. Confirme que aparece em *Pagamentos* como **Teste** e que o webhook chegou (log: `docker compose logs --since 10m app | grep "\[billing\] webhook"`).
4. Faça o cartão de R$ 1,00 (assinatura) e cancele em seguida.
5. Faça um cadastro de verdade (conta de teste), pague o plano e veja o acesso liberar sozinho.
6. Estorne os valores de teste em *Mercado Pago → Atividade*.
