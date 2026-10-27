param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$taskUrl = 'http://localhost:' + $taskConfig.port
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
function Test-CourseServer {
  & $taskNode (Join-Path $taskRoot 'scripts\health.mjs') $taskConfig.port
  return ($LASTEXITCODE -eq 0)
}
if (Test-CourseServer) {
  Write-Host ('Already running: ' + $taskUrl)
  if (-not $NoBrowser) { Start-Process $taskUrl }
  exit 0
}
$taskVersion = & $taskNode --version
if ([int]($taskVersion -replace '^v(\d+).*','$1') -lt 24) { throw 'Node.js 24 or newer is required.' }
$taskLogs = Join-Path $taskRoot 'logs'
$taskData = Join-Path $taskRoot 'data'
New-Item -ItemType Directory -Path $taskLogs,$taskData -Force | Out-Null
$taskServer = Join-Path $taskRoot 'server.mjs'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('--disable-warning=ExperimentalWarning',('"' + $taskServer + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogs 'server.out.log') -RedirectStandardError (Join-Path $taskLogs 'server.error.log') -PassThru
@{pid=$taskProcess.Id; started=$taskProcess.StartTime.ToUniversalTime().ToString('o'); server=$taskServer} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskData 'server-process.json') -Encoding UTF8
$taskReady = $false
for ($taskAttempt=0; $taskAttempt -lt 60; $taskAttempt++) {
  if ($taskProcess.HasExited) { throw ('Server exited; check ' + (Join-Path $taskLogs 'server.error.log')) }
  if (Test-CourseServer) { $taskReady=$true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $taskReady) { throw 'Server did not become ready; check logs.' }
Write-Host ('Running: ' + $taskUrl)
if (-not $NoBrowser) { Start-Process $taskUrl }
