param(
  [string]$ServiceName = 'postgresql-x64-18',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 5432
)

$ErrorActionPreference = 'Stop'

$service = Get-Service -Name $ServiceName -ErrorAction Stop
if ($service.Status -ne 'Running') {
  Write-Host "Iniciando o serviço $ServiceName..."
  Start-Service -Name $ServiceName
  $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
}

if ($service.StartType -ne 'Automatic') {
  try {
    Set-Service -Name $ServiceName -StartupType Automatic
    Write-Host "Inicialização automática habilitada para $ServiceName."
  } catch {
    Write-Warning "Não foi possível alterar o tipo de inicialização. Execute como Administrador para manter o serviço automático."
  }
}

$pgIsReady = Join-Path ${env:ProgramFiles} 'PostgreSQL\18\bin\pg_isready.exe'
if (-not (Test-Path -LiteralPath $pgIsReady)) {
  throw "Não encontrei pg_isready.exe em $pgIsReady."
}

& $pgIsReady -h $HostName -p $Port
if ($LASTEXITCODE -ne 0) {
  throw "O PostgreSQL não está aceitando conexões em ${HostName}:$Port."
}

Write-Host "PostgreSQL ativo em ${HostName}:$Port ($ServiceName)."
