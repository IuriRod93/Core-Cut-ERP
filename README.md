# Core Cut ERP

Sistema de gestão para **fábrica de marcenaria industrial**: comercial, projetos (no estilo ClickUp), engenharia de produto, PCP e chão de fábrica, estoque com o catálogo da **Leo Madeiras em reais (R$)**, compras, qualidade, logística e financeiro.

- **Frontend:** React 19 + TypeScript + Vite + Material UI (mesma base tecnológica do Genesis-ERP)
- **Backend:** Node.js (sem framework), com armazenamento JSON para desenvolvimento ou PostgreSQL para uso compartilhado
- **Visual:** identidade Core Cut em azul-petróleo, com layout responsivo para desktop e celular

## Como executar

Requisitos: **Node.js 20+** (testado com 24). Os testes do módulo de corte/G-code e a carga da demonstração usam *type stripping* nativo do Node e exigem **Node 22.18+** (ou 24).

```powershell
npm install
npm run build        # gera a interface (pasta dist)
npm start            # http://localhost:4400  (API + interface)
```

Para desenvolver com recarga automática: `npm run dev` (interface em `http://localhost:5173`, API em `4400`).
Quando estiver usando a configuração local do PostgreSQL, execute `npm run dev:local`: ele garante que o serviço `postgresql-x64-18` esteja iniciado, verifica `127.0.0.1:5432` e então sobe a API e o Vite.

| Comando | O que faz |
|---|---|
| `npm run dev` | API + Vite juntos, com proxy `/api` |
| `npm run dev:local` | Verifica/inicia o PostgreSQL local e executa o ambiente de desenvolvimento |
| `npm run db:reset -- --confirm` | Zera o banco local, remove arquivos enviados e recria a configuração inicial |
| `npm run db:seed-demo` | Carrega o cenário fictício completo para testes |
| `npm start` | Servidor de produção (serve `dist/` e a API) |
| `npm run db:check` | Verifica se o serviço PostgreSQL local está ativo e aceitando conexões |
| `npm run build` | Typecheck + build de produção |
| `npm test` | Testes de integração do backend, otimizador, G-code e importador Promob |
| `npm run catalog:export` | Reexporta o catálogo Leo Madeiras do banco do IROD-Orça |

Porta e pasta de dados: variáveis `PORT` (padrão **4400**) e `ARCOPLAN_DATA_DIR` (padrão `backend/data`).

Os comandos `db:reset` e `db:seed-demo` operam somente em `core_cut_erp` local e recusam execução se outra API estiver conectada. Pare o ambiente (`Ctrl+C`) antes de usá-los. O reset não remove o catálogo Leo Madeiras, que permanece no repositório. Para alterar a senha inicial do administrador antes de um reset, defina `ARCOPLAN_ADMIN_PASSWORD` no `.env`; ela deve ter pelo menos 8 caracteres.

### PostgreSQL

Para criar uma base PostgreSQL local limpa no Windows, abra o PowerShell **como Administrador** na pasta do projeto e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-local-postgres.ps1
npm start
```

O assistente verifica o serviço PostgreSQL 18, recusa apagar um banco já existente, cria uma role dedicada e um banco vazio, restaura o `pg_hba.conf` original e grava `DATABASE_URL` em `.env` (ignorado pelo Git). Ele não importa nem apaga o banco JSON antigo. O ERP cria as tabelas e os dados essenciais de inicialização na primeira execução. O `postgresql_18.exe` já foi instalado; não é necessário executar o instalador novamente.

Para usar um servidor diferente, copie `.env.example` para `.env` e configure `DATABASE_URL` manualmente. O `dotenv` carrega esse arquivo no backend. O modo padrão começa com uma base limpa e não apaga nem importa o banco JSON local:

```text
DATABASE_URL=postgresql://usuario:senha@servidor:5432/core_cut_erp
PGPOOL_MAX=10
DATABASE_IMPORT_JSON=0
PGSSLMODE=require
```

O usuário do banco precisa poder criar tabelas no schema utilizado e ler/gravar nelas. Na primeira inicialização, o servidor aplica migrations versionadas e cria `core_cut_schema_migrations`, `core_cut_documents` e `core_cut_runtime`; o ERP insere os dados essenciais de configuração, usuário administrador e centros de trabalho, sem clientes, projetos ou lançamentos. O catálogo Leo Madeiras permanece disponível para consulta. O banco JSON só é importado se `DATABASE_IMPORT_JSON=1` for explicitamente configurado antes da inicialização e o PostgreSQL estiver vazio. Com `DATABASE_URL` configurada, o servidor não usa o JSON local como armazenamento ativo. Sem essa variável, continua usando JSON para desenvolvimento e testes. A aplicação requer uma instância única do backend para esse armazenamento em cache; não execute várias instâncias do ERP contra o mesmo banco. Configure backups e TLS conforme o provedor PostgreSQL. Para provedores que exigem TLS, use `sslmode=require` na URL de conexão.

Defina `DATABASE_URL` como segredo no host do backend; não a coloque no frontend, no controle de versão ou em arquivo público. A aplicação só pode ser considerada conectada/migrada depois de iniciada com a conexão real do PostgreSQL e verificados os dados importados.

### Extensão e acesso offline

Execute `npm run extension:package` para gerar `release/core-cut-erp-extension.zip` e disponibilizar o mesmo pacote em `public/downloads/`. O primeiro acesso e o cabeçalho oferecem o download. O ZIP contém extensão Manifest V3 para Chrome e Edge; extraia-o e carregue a pasta pela página de extensões do navegador usando o modo de desenvolvedor. O `LEIA-ME.txt` incluído explica a instalação e a configuração do endereço HTTPS do servidor em cada navegador/computador. O pacote baixado localmente não significa publicação nas lojas oficiais.

A extensão precisa de internet e de um backend ativo para autenticação, consultas e gravações. O cache do aplicativo web pode ajudar a abrir a interface, mas não disponibiliza os dados do ERP nem permite trabalhar/sincronizar alterações offline.

### Primeiro acesso

Usuário **`admin`**, senha provisória **`arcoplan123`** (compatibilidade com a implantação atual). O sistema exige a troca da senha no primeiro login.
Em **Configurações → Dados e backup** é possível carregar *dados de demonstração* (clientes, projetos com tarefas, orçamentos, ordens, compras e financeiro) e removê-los depois sem afetar dados reais. Os usuários de demonstração (`carlos`, `ana`, `rafael`, `joao`, `marcos`, `luciana`, `paulo`, `fernanda`, `diego`) usam a senha `Demo@2026`.

## Módulos

| Área | Funcionalidades |
|---|---|
| **Painel** | Indicadores por perfil, receitas x despesas, projetos por etapa, fila por setor, alertas operacionais |
| **Projetos (estilo ClickUp)** | Portfólio em quadro/lista; por projeto: visão geral, **lista**, **quadro**, **calendário**, **cronograma (Gantt)** com dependências e arraste, **tabela**, **carga de trabalho**, arquivos. Tarefas com subtarefas, checklists, dependências, responsáveis, prioridade, etiquetas, estimativa, cronômetro, comentários com @menção, anexos, recorrência, marcos, campos personalizados, status customizáveis e modelos de projeto. Também: **seleção e ações em lote**, **visões salvas** (filtros + agrupamento), **automações** “quando … então …”, **limite WIP** e colunas recolhíveis no quadro, aba **Tempo** (folha de horas, estimado × registrado, CSV), **Documentos** do projeto (Markdown com checklists) e **Atividade** (feed do projeto); atalhos `C` (nova tarefa), `/` (buscar) e `Esc`. **Notificações** no sino (prazo amanhã/hoje/atrasada, menções, atribuições e automações) geradas por um agendador no servidor (a cada 15 min; `ARCOPLAN_SCHEDULER_MS` ajusta e `ARCOPLAN_WEBHOOK_URL` repassa cada aviso em JSON para WhatsApp/e-mail/n8n); automações por prazo (“faltam N dias”, “atrasada há N dias”). **Meu trabalho** reúne tarefas atribuídas, delegadas e menções, agrupadas por prazo, projeto ou prioridade |
| **Meu trabalho / Agenda** | Tarefas de todos os projetos por prazo; calendário com compromissos, entregas e tarefas |
| **Comercial** | Funil de leads (arrastar e soltar), clientes, **orçamentos** com custo real, margem, impostos e **PDF** com a marca, contratos com parcelas e geração de contas a receber |
| **Produção** | **Fichas técnicas** (peças, fita, usinagens, ferragens, roteiro) com custo e gerador paramétrico; **ordens de produção** com roteiro por setor, necessidade de materiais, baixa de estoque e geração de compra; **chão de fábrica** com apontamento; **plano de corte** multi-material com fitagem, usinagens (dobradiça, minifix, cavilha, pinos, rasgos), custo em R$ pelo catálogo Leo, vínculo a projeto/responsável, PDF, etiquetas e **G-code ISO por chapa**; qualidade (RNC); manutenção com recorrência |
| **Logística** | Entregas, instalações e medições com equipe, veículo e checklist; garantias/assistência |
| **Suprimentos** | Estoque com saldo mínimo e movimentações atômicas; **catálogo Leo Madeiras** (3.944 chapas, 768 ferragens, 840 fitas — preços em R$); compras do rascunho ao recebimento; fornecedores e prestadores |
| **Financeiro** | Contas a receber/pagar com parcelamento e baixa, fluxo de caixa projetado, DRE por categoria, contas bancárias, produtos e serviços |
| **Gestão** | Equipe e permissões por módulo, ponto e espelho mensal, veículos, relatórios (CSV/Excel/impressão), arquivos, logs de acesso, lixeira, backup/restauração |

## Catálogo Leo Madeiras (preços em reais)

O catálogo vem de `backend/catalog/leo-madeiras.json`, exportado do banco local do **IROD-Orça** (mesma fonte usada no Genesis-ERP), **sem conversão de moeda**. O script lê apenas as tabelas de catálogo (`materials`, `hardware`, `edge_bands`) — credenciais, clientes e orçamentos do Orça nunca são tocados.

Para atualizar: atualize os preços no IROD-Orça, execute `npm run catalog:export` e, em **Estoque e catálogo → Catálogo**, use **Atualizar preços do estoque**. Os itens do estoque vinculados ao catálogo têm o custo atualizado e o histórico de preço preservado. Apenas 1.200 das 3.944 chapas possuem preço publicado na base atual; as demais aparecem como “sob consulta”.

## Perfis e segurança

Perfis: Administrador, Gerência, Comercial, Projetos e design, PCP e produção, Operação de fábrica, Suprimentos, Financeiro e Entrega e instalação. Cada usuário pode receber módulos extras ou ter módulos revogados. As permissões são aplicadas **no servidor** (por coleção), não apenas na interface.

- Senhas com `scrypt`; sessões com token aleatório (12 h, renovação por uso); bloqueio por tentativas de login
- Troca de senha obrigatória no primeiro acesso e após redefinição por administrador
- Auditoria de criações, alterações, exclusões, logins e uploads; exclusões vão para a lixeira
- Backup diário automático (14 dias) em `backend/data/backups` no modo JSON; com PostgreSQL, configure backups no provedor do banco

## Planos, assinatura e pagamentos (Mercado Pago)

Cada empresa cadastrada em `/cadastro` é um **inquilino isolado**: dados, usuários, códigos sequenciais, configurações e arquivos são próprios, e uma empresa nunca enxerga nem altera os dados de outra. A base original (usuário `admin@corecut.local`) continua sendo a "plataforma" e lista as assinantes em *Configurações → Assinatura*.

| Plano | Preço | Usuários | Projetos | Orçamentos | Ordens de produção | Itens de estoque | Módulos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Essencial | R$ 99/mês | 3 | 50 | 100 | 50 | 200 | CRM, orçamentos, contratos, projetos, produção (ordens), estoque, fornecedores, financeiro, equipe, ponto, arquivos |
| Profissional | R$ 199/mês | 10 | 200 | 500 | 200 | 1.000 | + plano de corte, fichas técnicas, compras, qualidade, entregas, garantias, logs |
| Industrial | R$ 399/mês | ilimitado | ilimitado | ilimitado | ilimitado | ilimitado | + chão de fábrica, manutenção, veículos, relatórios |

Os limites e módulos ficam em `backend/lib/billing.mjs` (`BILLING_PLANS`) e valem em **todas** as rotas que criam registros (CRUD, aprovação de orçamento, importação do catálogo, restauração da lixeira). Ao atingir o limite a API responde `403` com a mensagem do plano.

**Formas de pagamento (Mercado Pago)**

- **Cartão** — assinatura (`/preapproval`) com cobrança mensal automática. O cliente é levado à página do Mercado Pago para autorizar o cartão e volta ao ERP. Cancelamento em *Configurações → Assinatura* (o período já pago continua valendo).
- **PIX** — pagamento (`/v1/payments`, `payment_method_id: pix`) por **1, 3 ou 6 meses**, com **QR Code e "copia e cola" exibidos no próprio ERP**. O pagamento libera o plano até a data de validade; renovar gera outro PIX e soma à validade atual.

**Acesso:** com pagamento pendente, vencido (após 3 dias de carência) ou cancelado, o titular entra no sistema e vê apenas a tela de pagamento; as demais rotas respondem `402`. Falha de renovação no cartão (assinatura pausada) mantém o acesso com aviso.

**Confirmação do pagamento** funciona de três formas e é idempotente: retorno do pagamento (`/assinatura?ref=…` e o próprio QR Code, que confere a cada 4 s), webhook e reconciliação automática no login. Os dados sempre vêm da API do Mercado Pago, nunca só do corpo da notificação. Em desenvolvimento não é preciso webhook.

**Configuração** (`.env` do servidor):

```
MERCADOPAGO_ACCESS_TOKEN=APP_USR-...      # painel Mercado Pago → Suas integrações → Credenciais
MERCADOPAGO_MODE=test                     # só com credenciais de usuário de teste (APP_USR-...); tokens TEST-... já são teste
MERCADOPAGO_WEBHOOK_SECRET=...            # "Assinatura secreta" em Webhooks (opcional em desenvolvimento)
APP_URL=http://localhost:5174             # endereço pelo qual o cliente acessa o ERP (https público em produção)
```

Webhook (painel do Mercado Pago → Webhooks): URL `https://SEU-ENDERECO/api/billing/webhook`, eventos *Pagamentos* e *Planos e assinaturas*.

**Checklist** — rode `npm run billing:check`: ele lê a conta e o `.env` e lista o que falta. Com `--test-pix` cria um PIX de R$ 1,00 (não pago) e com `--test-card` uma assinatura pendente (sem cobrança) para validar a conta e o endereço de retorno. Para testar sem cobrar, use as credenciais de teste e os usuários de teste do Mercado Pago.

## Estrutura

```
backend/        API Node, persistência, catálogo Leo Madeiras, testes
shared/         Perfis, módulos e regras de acesso (usado por backend e frontend)
src/
  brand/        Logo vetorizada (SVG)
  components/   UI kit, formulários, CrudPage, navegador de arquivos
  domain/       Regras de negócio: tarefas, orçamento, BOM, corte, PDF, alertas
  layout/       Shell, menu lateral, busca global (Ctrl+K)
  pages/        Telas por módulo (pages/workspace = visões do projeto)
scripts/        dev.mjs e exportação do catálogo
```

## Pontos de atenção

- Sem integrações externas de e-mail, assinatura digital e NF-e nesta versão (pagamentos usam o Mercado Pago).
- Imagens do catálogo são carregadas diretamente do CDN da Leo Madeiras (`images.cws.digital`).

## Plano de corte e G-code

1. **Dados do plano:** título, **projeto** (obrigatório), **responsável**, OP opcional, método (seccionadora ou router CNC), chapa e fita padrão — escolhidas no estoque ou direto do **catálogo Leo Madeiras** (o item é adicionado ao estoque com o preço em R$).
2. **Peças:** medidas, quantidade, chapa própria, giro, **fitas C1/C2/L1/L2** e **usinagens** por peça (dobradiça Ø35, minifix, cavilha, confirmat, pinos do sistema 32, puxador, furos livres, rasgo de fundo e recortes) com pré-visualização. Importação por lista colada (Excel), ficha técnica ou ordem de produção.
3. **Otimização:** agrupa por material, usa MaxRects com várias heurísticas, respeita veio, refilo e disco/folga de fresa.
4. **Custos:** chapas, fita (+10% de perda), ferragens (sugeridas pelos furos) e tempo de máquina pelo custo/hora dos setores.
5. **G-code:** programa ISO por chapa — furações por diâmetro (com passo/peck), rasgos, recortes e contornos com pontes de fixação; baixa individual (.nc) ou todas (.zip). Parâmetros de fresa, avanços e troca de ferramenta ajustáveis. **Valide o pós-processador na sua máquina antes de produzir.** Furos de borda não entram no G-code (exigem cabeçote horizontal).
6. **Saídas:** relatório PDF no estilo "Mapa de Corte" (logo, resumo e custos, uma página por chapa com lista de cortes, mapa colorido com fitas/furos/rasgos, legendas e tabela de usinagens) e etiquetas adesivas por peça com **logo, QR Code** (abre o plano na peça) e, no layout completo (2 × 4 por A4), o **desenho da peça** e a **miniatura da chapa otimizada** com a posição do corte; layout compacto 3 × 8 também disponível.

### Importação do Promob

Em **Peças → Importar do Promob** (ou anexando o arquivo a uma tarefa do projeto) o sistema lê:

| Formato | O que é lido |
|---|---|
| **CSV** lista de corte (Cut Pro) | peças, medidas, quantidade, material e chapa, veio, fitas por face (frente, traseira, esquerda, direita) |
| **CSV** de peças (PT ou EN) | contorno por vértices (peças em L), fitas por aresta, furos por face (topo, inferior, borda) e rasgos nos dois sentidos, a partir do JSON de operações |
| **XML** listagem | peças, materiais, fitas, quantidade de arestas, ferragens com multiplicador dos módulos |
| **DXF** por chapa ou simples | contornos fechados, furos (diâmetro/profundidade pela camada), rasgos, rótulos e dimensões da chapa; vários DXFs juntos |
| **DXT** | lista de peças (nome, medidas, material, quantidade, giro); DXFs enviados junto completam contorno e usinagens |

Depois da leitura o diálogo mostra o que foi encontrado (peças, furos, fita, formas não retangulares, avisos) e permite **mapear cada material do arquivo ao estoque** ou direto ao catálogo Leo Madeiras (a sugestão automática compara cor e espessura). Limitações do Promob: o XML não informa o lado da fita nem as coordenadas dos furos (use CSV de peças ou DXF); contornos com arco são aproximados por segmentos retos; no encaixe a peça em L ocupa o retângulo envolvente.

### Orçamento e compras

- Ao salvar o plano, o custo (chapas, fita, ferragens e usinagem) é **somado ao orçamento do projeto** como itens do plano (atualizados a cada salvamento, sem duplicar); se o projeto não tem orçamento, é criado um rascunho.
- **Gerar solicitação de compras** (aba *Custos e ferragens*): lista chapas, fita e ferragens do plano otimizado descontando o saldo do estoque; os itens marcados viram pedidos por fornecedor em **Compras**, com origem no plano.
- Em Compras, **administração, gerência e financeiro** aprovam ou reprovam (motivo obrigatório; reabertura como rascunho). A regra vale no servidor, não apenas na tela.
- Anexar um CSV/XML/DXF/DXT a uma **tarefa** cria um plano de corte em rascunho no projeto, marcado "aguardando revisão".

## Fotos da equipe

Cada usuário pode ter foto (Equipe → editar usuário, ou o menu do avatar → *Meu perfil e foto*). A imagem é recortada em quadrado e aparece no quadro de projetos, tarefas, planos de corte e listas.
