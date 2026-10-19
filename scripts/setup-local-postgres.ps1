$ErrorActionPreference = 'Stop'

$serviceName = 'postgresql-x64-18'
$pgRoot = 'C:\Program Files\PostgreSQL\18'
$pgBin = Join-Path $pgRoot 'bin'
$authFile = Join-Path $pgRoot 'data\pg_hba.conf'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador e execute este script novamente.'
}

if (-not (Test-Path -LiteralPath (Join-Path $pgBin 'psql.exe'))) {
  throw "Não encontrei o PostgreSQL 18 em $pgRoot."
}
if (-not (Test-Path -LiteralPath $authFile)) {
  throw "Não encontrei a configuração de autenticação em $authFile."
}
if (Test-Path -LiteralPath $envFile) {
  throw "O arquivo .env já existe. Por segurança, não vou sobrescrevê-lo. Revise-o ou faça uma cópia fora do projeto antes de executar este assistente."
}

$service = Get-Service -Name $serviceName -ErrorAction Stop
if ($service.Status -ne 'Running') {
  throw "O serviço $serviceName não está iniciado."
}

$backupFile = Join-Path $env:TEMP ('core-cut-pg-hba-' + [guid]::NewGuid().ToString('N') + '.bak')
$sqlFile = Join-Path $env:TEMP ('core-cut-db-' + [guid]::NewGuid().ToString('N') + '.sql')
$originalAuth = [IO.File]::ReadAllText($authFile)
$authChanged = $false
$databaseCreated = $false
$roleCreated = $false
$dbPassword = $null

try {
  Copy-Item -LiteralPath $authFile -Destination $backupFile
  $localhostRule = '(?m)^(host\s+all\s+all\s+(?:127\.0\.0\.1/32|::1/128)\s+)scram-sha-256\s*$'
  $ruleMatches = [regex]::Matches($originalAuth, $localhostRule)
  if ($ruleMatches.Count -ne 2) {
    throw "Esperava exatamente duas regras SCRAM para localhost; encontrei $($ruleMatches.Count). Nenhuma configuração foi alterada."
  }

  $temporaryAuth = [regex]::Replace(
    $originalAuth,
    $localhostRule,
    '$1trust',
    [Text.RegularExpressions.RegexOptions]::Multiline
  )
  [IO.File]::WriteAllText($authFile, $temporaryAuth, [Text.UTF8Encoding]::new($false))
  $authChanged = $true

  Restart-Service -Name $serviceName -Force
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 5432 *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'O PostgreSQL não voltou a aceitar conexões em localhost:5432.'
  }

  $psql = Join-Path $pgBin 'psql.exe'
  $existingDatabase = & $psql -X -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = 'core_cut_erp';"
  if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível verificar o banco PostgreSQL: $existingDatabase"
  }
  if ($existingDatabase) {
    throw 'O banco core_cut_erp já existe. Não vou apagá-lo. Faça backup e peça confirmação antes de substituí-lo.'
  }

  $existingRole = & $psql -X -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -Atc "SELECT 1 FROM pg_roles WHERE rolname = 'core_cut_app';"
  if ($LASTEXITCODE -ne 0) {
    throw "Não foi possível verificar o usuário PostgreSQL: $existingRole"
  }
  if ($existingRole) {
    throw 'O usuário PostgreSQL core_cut_app já existe. Não vou reutilizá-lo nem alterar suas permissões automaticamente.'
  }

  $randomBytes = New-Object byte[] 36
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($randomBytes)
  }
  finally {
    $random.Dispose()
  }
  $dbPassword = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

  $sql = @"
CREATE ROLE core_cut_app LOGIN PASSWORD '$dbPassword';
"@
  [IO.File]::WriteAllText($sqlFile, $sql, [Text.UTF8Encoding]::new($false))
  & $psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -f $sqlFile
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao criar a role PostgreSQL.'
  }
  $roleCreated = $true
  & $psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U postgres -d postgres -c 'CREATE DATABASE core_cut_erp OWNER core_cut_app;'
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao criar o banco PostgreSQL.'
  }
  $databaseCreated = $true
}
catch {
  if ($roleCreated -and -not $databaseCreated) {
    & (Join-Path $pgBin 'psql.exe') -X -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -c 'DROP ROLE IF EXISTS core_cut_app;' *> $null
  }
  throw
}
finally {
  if ($authChanged) {
    Copy-Item -LiteralPath $backupFile -Destination $authFile -Force
    Restart-Service -Name $serviceName -Force
    $restored = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 5432 *> $null
      if ($LASTEXITCODE -eq 0) {
        $restored = $true
        break
      }
      Start-Sleep -Seconds 1
    }
    if (-not $restored) {
      throw "O pg_hba.conf original foi restaurado, mas o serviço não respondeu. Cópia de segurança preservada em $backupFile"
    }
  }

  if (Test-Path -LiteralPath $sqlFile) {
    Remove-Item -LiteralPath $sqlFile -Force
  }
  if (Test-Path -LiteralPath $backupFile) {
    Remove-Item -LiteralPath $backupFile -Force
  }
}

if (-not $databaseCreated -or -not $roleCreated) {
  throw 'A criação do PostgreSQL não foi concluída.'
}

$envContents = @"
DATABASE_URL=postgresql://core_cut_app:$dbPassword@localhost:5432/core_cut_erp
DATABASE_IMPORT_JSON=0
"@
[IO.File]::WriteAllText($envFile, $envContents, [Text.UTF8Encoding]::new($false))

$env:PGPASSWORD = $dbPassword
try {
  & (Join-Path $pgBin 'psql.exe') -X -w -h 127.0.0.1 -p 5432 -U core_cut_app -d core_cut_erp -Atc 'SELECT current_database(), current_user;'
  if ($LASTEXITCODE -ne 0) {
    throw 'A role do ERP não conseguiu conectar após a restauração da autenticação SCRAM.'
  }
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  $dbPassword = $null
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
}

Write-Host "Banco core_cut_erp criado e validado em localhost:5432."
Write-Host "Configuração salva em $envFile (arquivo ignorado pelo Git)."
Write-Host 'O ERP criará as tabelas e configurações iniciais ao iniciar; o banco JSON existente foi preservado.'
Write-Host 'Agora execute: npm start'
