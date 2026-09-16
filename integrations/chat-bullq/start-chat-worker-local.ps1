$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskKeyFile = Join-Path $taskRoot 'work/chat-bullq-local/.env.local'
if (!(Test-Path -LiteralPath $taskKeyFile)) { throw 'Inicie primeiro o ChatBullQ local.' }
$taskLine = Get-Content -LiteralPath $taskKeyFile | Where-Object { $_ -match '^PLATFORM_API_KEY=' } | Select-Object -First 1
if (!$taskLine) { throw 'Chave local de plataforma ausente.' }
$taskStateFile = Join-Path $taskRoot 'work/chat-worker-running.json'
if (Test-Path -LiteralPath $taskStateFile) {
  $taskState = Get-Content -LiteralPath $taskStateFile -Raw | ConvertFrom-Json
  $taskOld = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskState.pid)" -ErrorAction SilentlyContinue
  if ($taskOld) {
    if ($taskOld.CommandLine.TrimEnd() -notmatch '^"[^"\r\n]*node\.exe" --import tsx server/chat-worker\.ts$') { throw 'PID ocupado por outro processo; nenhum processo encerrado.' }
    Stop-Process -Id $taskOld.ProcessId
  }
}
$env:NODE_ENV = 'development'
$env:CHAT_BULLQ_URL = 'http://127.0.0.1:3002'
$env:CHAT_BULLQ_PLATFORM_KEY = $taskLine.Substring('PLATFORM_API_KEY='.Length).Trim().Trim('"').Trim("'")
$taskNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
# Sem --enviar: este iniciador sempre sobe ENSAIO, inclusive se o provedor habilitou automação.
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('--import', 'tsx', 'server/chat-worker.ts') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'work/chat-worker.log') -RedirectStandardError (Join-Path $taskRoot 'work/chat-worker.err.log') -PassThru
@{ pid = $taskProcess.Id; modo = 'ensaio' } | ConvertTo-Json | Set-Content -LiteralPath $taskStateFile
Write-Output "Motor local em ensaio (PID $($taskProcess.Id)): lê a fila e não envia mensagens."
