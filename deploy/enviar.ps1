# Envia o projeto para o servidor e (opcionalmente) sobe os containers.
# Executar NO SEU WINDOWS, na pasta do projeto:
#   powershell -ExecutionPolicy Bypass -File deploy\enviar.ps1 -Servidor 85.209.92.9
#   ... -Subir     também roda "docker compose up -d --build" no servidor
param(
  [Parameter(Mandatory = $true)][string]$Servidor,
  [string]$Usuario = 'root',
  [switch]$Subir
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$pacote = Join-Path $env:TEMP 'corecut-deploy.tar.gz'

Write-Host "Empacotando $raiz ..."
if (Test-Path $pacote) { Remove-Item $pacote -Force }
tar -czf $pacote -C $raiz `
  --exclude=node_modules --exclude=dist --exclude=backend/data --exclude=release --exclude=marketing `
  --exclude=CoreCut-App/node_modules --exclude=CoreCut-App/.expo --exclude=CoreCut-App/.git `
  --exclude=CoreCut-App/build --exclude=CoreCut-App/android/.gradle --exclude=CoreCut-App/android/app/build `
  --exclude=CoreCut-App/gradle-build.log `
  --exclude=.git --exclude=.claude --exclude=.playwright-mcp --exclude='.env' --exclude='.env.*' `
  --exclude=deploy/.env --exclude='*.log' --exclude='*.tsbuildinfo' .
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar.' }

Write-Host "Enviando para ${Usuario}@${Servidor} ..."
scp $pacote "${Usuario}@${Servidor}:/tmp/corecut-deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Falha no envio (scp).' }

# O script remoto segue por stdin (o Windows estraga aspas e curingas quando o comando vai como argumento do ssh).
$remoto = @'
set -e
mkdir -p /opt/corecut
tar -xzf /tmp/corecut-deploy.tar.gz -C /opt/corecut
rm -f /tmp/corecut-deploy.tar.gz
for f in /opt/corecut/deploy/*.sh; do sed -i 's/\r$//' "$f"; done
echo "Projeto extraido em /opt/corecut"
'@
if ($Subir) { $remoto += "`ncd /opt/corecut/deploy`ndocker compose up -d --build`ndocker compose ps`n" }
$remoto = $remoto -replace "`r", ''
$remoto | ssh "${Usuario}@${Servidor}" bash -s
if ($LASTEXITCODE -ne 0) { throw 'Falha ao extrair/subir no servidor.' }
Write-Host 'Concluido.'
