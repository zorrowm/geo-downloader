param(
  [Parameter(Mandatory = $true)]
  [string]$Token
)

$ErrorActionPreference = 'Stop'

$script = 'C:\nginx-1.30.2\tools\qr-upload-server.js'
$tokenFile = 'C:\nginx-1.30.2\qr-admin-token.txt'

if ([string]::IsNullOrWhiteSpace($Token)) {
  throw 'QR admin token is empty'
}

Set-Content -LiteralPath $tokenFile -Value $Token -NoNewline -Encoding UTF8

$node = (Get-Command node.exe -ErrorAction Stop).Source

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*qr-upload-server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$taskName = 'GeoDQrAdmin'
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`""
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force | Out-Null

Start-Process -FilePath $node -ArgumentList @($script) -WindowStyle Hidden
Start-Sleep -Seconds 3

$response = Invoke-WebRequest -Uri 'http://127.0.0.1:9090/qr-admin/' -UseBasicParsing -TimeoutSec 10
if ($response.StatusCode -ne 200) {
  throw "QR admin returned status $($response.StatusCode)"
}

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*qr-upload-server.js*' } |
  Select-Object ProcessId,CommandLine |
  Format-List
