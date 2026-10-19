# Publicar o Core Cut em www.cutcore.com.br

Servidor: Ubuntu 24.04 (VPS) · IP: `85.209.92.9` · Domínio: `cutcore.com.br` (principal: `www.cutcore.com.br`)

O site público (página inicial da Core Cut) fica em `/`; o ERP fica em `/login` e `/painel`; o cadastro
de empresas em `/cadastro`.

> **Confira o IP e o nome do domínio antes de tudo.** No servidor, `curl -4 ifconfig.me` mostra o IP
> que vai no DNS. Escreva o domínio exatamente como foi registrado: **cutcore**.com.br (não corecut).

## 0. Backup do que existe hoje

O servidor tem `/opt/irod-remote` (Docker Compose + Caddy). A limpeza o apaga. O script de limpeza faz
backup em `/root/backup-antes-da-limpeza-*`; copie para o seu computador antes de seguir:

```bash
scp -r root@85.209.92.9:/root/backup-antes-da-limpeza-* .
```

## 1. Limpar o servidor

**A) Mantendo o Ubuntu** (apaga Docker e `/opt`):

```bash
# do seu Windows (na pasta do projeto)
scp deploy/server-wipe.sh deploy/server-setup.sh root@85.209.92.9:/root/
ssh root@85.209.92.9
bash /root/server-wipe.sh      # mostra tudo, pede para digitar APAGAR TUDO, faz backup e apaga
```

**B) Zerar de verdade:** no painel da hospedagem use *Reinstalar / Rebuild OS* → Ubuntu 24.04.
Depois siga o passo 2.

## 2. Preparar o servidor (Docker + firewall)

```bash
bash /root/server-setup.sh
```

## 3. DNS do domínio

No painel onde `cutcore.com.br` é gerenciado (Registro.br → DNS, ou Cloudflare etc.) crie:

| Tipo | Nome | Valor | TTL |
| --- | --- | --- | --- |
| A | `@` (cutcore.com.br) | `85.209.92.9` | 300 |
| A | `www` | `85.209.92.9` | 300 |

Se usar Cloudflare, deixe a nuvem **cinza** (somente DNS) até o HTTPS ser emitido. Remova registros
antigos de `@` e `www` que apontem para outro IP. Confira:

```bash
nslookup www.cutcore.com.br
```

O certificado HTTPS só é emitido quando o domínio já resolve para o servidor (de minutos a horas).

## 4. Enviar o projeto

Linux/macOS:

```bash
bash deploy/enviar.sh 85.209.92.9 --subir
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\enviar.ps1 -Servidor 85.209.92.9 -Subir
```

O pacote inclui `CoreCut-App` e `eas.json` para que o projeto e as instruções de build iOS também
fiquem em `/opt/corecut/CoreCut-App`. Dependências e artefatos locais de build são excluídos.

## 5. Configurar o `.env` do servidor

```bash
ssh root@85.209.92.9
cd /opt/corecut/deploy
bash gerar-env.sh cutcore.com.br
```

Gera as senhas, pede o **Access Token do Mercado Pago** (digitado, sem aparecer) e mostra a senha
inicial do administrador **uma única vez**.

## 6. Subir

```bash
cd /opt/corecut/deploy
docker compose up -d --build
docker compose ps
docker compose logs -f app      # Ctrl+C para sair
```

Abra `https://www.cutcore.com.br/` (site) e `https://www.cutcore.com.br/api/health`
(deve responder `{"status":"ok","database":"postgresql",…}`). O ERP: `https://www.cutcore.com.br/login`
com `admin@corecut.local` e a senha gerada (a troca é exigida no primeiro acesso).

## 7. Mercado Pago (webhook)

Painel → Suas integrações → sua aplicação → **Webhooks** → Configurar notificações (produção):

- URL: `https://www.cutcore.com.br/api/billing/webhook`
- Eventos: **Pagamentos** e **Planos e assinaturas**
- Copie a **Assinatura secreta** para `MERCADOPAGO_WEBHOOK_SECRET` no `.env` do servidor e rode
  `docker compose up -d`.

Para conferir a conta e o token, no seu computador (com o token no `.env` local): `npm run billing:check`.

## 8. Primeiro pagamento real

Cadastre uma empresa em `https://www.cutcore.com.br/cadastro` no plano Essencial (R$ 99), pague por
PIX com seu banco, confirme que o acesso é liberado sozinho e estorne pelo Mercado Pago. Repita com o
cartão.

## Se a porta 80 estiver ocupada

Erro `Bind for 0.0.0.0:80 failed: port is already allocated` = outro serviço (o Caddy do antigo
`irod-remote`) ainda está rodando. Pare só ele e suba o Core Cut:

```bash
ss -tlnp | grep -E ':80 |:443 '                 # quem está usando as portas
docker ps --format 'table {{.Names}}	{{.Ports}}'
cd /opt/irod-remote && docker compose -f docker-compose.production.yml down    # mantém os volumes
cd /opt/corecut/deploy && docker compose up -d
```

## Proteções ativas

- **Aplicação:** limite de requisições por IP (login, cadastro e API), bloqueio de login após 6 erros,
  cabeçalhos de segurança (CSP, HSTS, X-Frame-Options…), tempo limite de conexões e reinício automático.
- **Servidor:** firewall (somente 22/80/443), `fail2ban` no SSH, atualizações de segurança automáticas,
  PostgreSQL sem porta pública e contêiner da aplicação sem privilégios.
- **Recomendado:** entrar no SSH por chave e desativar a senha de root
  (`PasswordAuthentication no` em `/etc/ssh/sshd_config`, depois `systemctl restart ssh`) — só faça isso
  depois de confirmar que a chave funciona.

## Backup diário

```bash
chmod +x /opt/corecut/deploy/backup.sh
(crontab -l 2>/dev/null; echo "0 3 * * * /bin/bash /opt/corecut/deploy/backup.sh") | crontab -
bash /opt/corecut/deploy/backup.sh     # teste agora
```

Os arquivos ficam em `/opt/corecut/backups` (14 dias). Copie-os periodicamente para fora do servidor.

## Painel Admin

Entre em `https://www.cutcore.com.br/login` com `admin@corecut.local`: o item **Painel Admin** aparece no
menu (`/admin`). Lá você vê as empresas, os testes de 48 horas, quem pagou, quem entrou, cria
credenciais, libera licenças manuais, suspende e exclui empresas.

## Operação

```bash
cd /opt/corecut/deploy
docker compose logs -f app                 # logs
docker compose up -d --build               # atualizar depois de um novo envio
docker compose exec db pg_dump -U corecut corecut | gzip > ~/corecut-$(date +%F).sql.gz   # backup
```

Faça backup do PostgreSQL com frequência e copie para fora do servidor. O volume `appdata` guarda os
arquivos enviados pelos usuários.

## Contatos do site

Telefone/WhatsApp, Instagram e e-mail exibidos na página inicial ficam na constante `CONTACT` no
início de `src/pages/Landing.tsx`. O e-mail só aparece quando `CONTACT.email` é preenchido.

## Diagnóstico de erros do servidor

```bash
cd /opt/corecut/deploy
bash diagnostico.sh        # últimas 24 h (containers, API, erros 500, telas que quebraram, disco, backup)
bash diagnostico.sh 72h    # janela maior
```

- **Erros do servidor** (HTTP 500, falhas do banco) e **telas que quebraram no navegador** dos usuários
  também aparecem em tempo real no Painel Admin → *Monitoramento* (`/admin`).
- Linhas de log: `[erro]` = falha interna · `[fatal]` = processo reiniciado · `[db]` = banco ·
  `[navegador]` = tela que quebrou para um usuário.
