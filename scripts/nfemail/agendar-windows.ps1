# Registra no Agendador de Tarefas do Windows a importação automática de NFs: todo dia às 08:00 e às 14:00.
# Uso (PowerShell, na pasta do projeto que tem node_modules):  powershell -ExecutionPolicy Bypass -File scripts\nfemail\agendar-windows.ps1
# Remover:  schtasks /Delete /TN "ND Carretas - Importar NFs 08h" /F ; schtasks /Delete /TN "ND Carretas - Importar NFs 14h" /F
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$node = (Get-Command node).Source
$script = Join-Path $root "scripts\nfemail\sincronizar.mjs"
if (-not (Test-Path (Join-Path $root "node_modules\playwright-core"))) { throw "Rode 'npm install' em $root antes (falta playwright-core)." }

foreach ($hour in @("08:00", "14:00")) {
  $name = "ND Carretas - Importar NFs " + $hour.Substring(0, 2) + "h"
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -Daily -At $hour
  # roda mesmo se o horário foi perdido (computador desligado), assim que ligar; só com o usuário conectado (o portal abre o Chrome)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "Baixa as NFs de entrada e saída do NFeMail e importa no ERP, sem repetir." -Force | Out-Null
  Write-Host "Agendada: $name"
}
