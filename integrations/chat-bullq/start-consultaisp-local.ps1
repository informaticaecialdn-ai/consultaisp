$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskSecrets = Join-Path $taskRoot 'work/chat-bullq-local/.env.local'
if (!(Test-Path -LiteralPath $taskSecrets)) { throw 'Inicie primeiro o ChatBullQ local conforme LOCAL.md.' }
$taskSecretLine = Get-Content -LiteralPath $taskSecrets | Where-Object { $_ -match '^PLATFORM_API_KEY=' } | Select-Object -First 1
if (!$taskSecretLine) { throw 'Chave de plataforma local ausente.' }
$taskKey = $taskSecretLine.Substring('PLATFORM_API_KEY='.Length).Trim().Trim('"').Trim("'")
if ($taskKey.Length -lt 32) { throw 'Chave de plataforma local inválida.' }

$taskStatePath = Join-Path $taskRoot 'work/local-running.json'
$taskState = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
$taskOld = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskState.app.pid)" -ErrorAction SilentlyContinue
if ($taskOld) {
  if ($taskOld.CommandLine -notmatch '^"[^"\r\n]*node\.exe" --import tsx server/index\.ts$') { throw 'O PID registrado agora pertence a outro processo. Nenhum processo foi encerrado.' }
  Stop-Process -Id $taskOld.ProcessId
}
$env:NODE_ENV = 'development'
$env:HOST = '127.0.0.1'
$env:PORT = '5000'
$env:RUN_BG_JOBS_IN_API = 'false'
$env:SEED_DEMO_DATA = 'false'
$env:CHAT_BULLQ_URL = 'http://127.0.0.1:3002'
$env:CHAT_BULLQ_PLATFORM_KEY = $taskKey
$env:CHAT_BULLQ_WEBHOOK_URL = 'http://127.0.0.1:5000/api/webhooks/chat-bullq'
$taskNode = (Get-Command node -CommandType Application | Select-Object -First 1).Source
$taskApp = Start-Process -FilePath $taskNode -ArgumentList @('--import', 'tsx', 'server/index.ts') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'work/local-app.log') -RedirectStandardError (Join-Path $taskRoot 'work/local-app.err.log') -PassThru
$taskState.app.pid = $taskApp.Id
$taskState | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskStatePath
Write-Output "Consulta ISP local: http://127.0.0.1:5000 (PID $($taskApp.Id)); ChatBullQ: http://127.0.0.1:3002"
