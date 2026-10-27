$ErrorActionPreference='Stop'
$taskPidFile=Join-Path $PSScriptRoot 'data\server-process.json'
if (-not (Test-Path -LiteralPath $taskPidFile)) { Write-Host 'No managed server process.'; exit 0 }
$taskInfo=Get-Content -LiteralPath $taskPidFile -Raw -Encoding UTF8 | ConvertFrom-Json
$taskStarted=([datetime]$taskInfo.started).ToUniversalTime().ToString('o')
$taskProcess=Get-Process -Id $taskInfo.pid -ErrorAction SilentlyContinue
if ($taskProcess) {
  $taskExpected=Join-Path $PSScriptRoot 'server.mjs'
  $taskCommand=(Get-CimInstance Win32_Process -Filter ('ProcessId=' + $taskInfo.pid)).CommandLine
  if ($taskProcess.ProcessName -ne 'node' -or $taskInfo.server -ne $taskExpected -or -not $taskCommand.Contains($taskExpected) -or $taskProcess.StartTime.ToUniversalTime().ToString('o') -ne $taskStarted) { throw 'Process identity changed; refusing to stop it.' }
  Stop-Process -Id $taskProcess.Id
}
Remove-Item -LiteralPath $taskPidFile
Write-Host 'Course server stopped.'
