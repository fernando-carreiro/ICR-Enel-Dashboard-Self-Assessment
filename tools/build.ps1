# Reconstroi data/dataset.js a partir das planilhas em data/raw.
# Uso: powershell -ExecutionPolicy Bypass -File tools/build.ps1
#
# As datas de posicao vem de data/sources.json (metadados do SharePoint).
# Ao trocar de planilha, atualize esse arquivo com o novo nome e a data de
# modificacao exibida no SharePoint, depois rode este script.
param(
  [string]$MonitoringStamp,
  [string]$IssuesStamp
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$sources = Get-Content (Join-Path $root 'data/sources.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$monitoringPath = Join-Path $root ('data/raw/' + $sources.monitoring.file)
$issuesPath = Join-Path $root ('data/raw/' + $sources.issues.file)

if (-not (Test-Path $monitoringPath)) { throw "Arquivo nao encontrado: $monitoringPath" }
if (-not (Test-Path $issuesPath)) { throw "Arquivo nao encontrado: $issuesPath" }

if (-not $MonitoringStamp) { $MonitoringStamp = $sources.monitoring.modified }
if (-not $IssuesStamp) { $IssuesStamp = $sources.issues.modified }

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools/xlsx_to_json.ps1') `
  -Path $monitoringPath -Out (Join-Path $root 'data/src/monitoring.json')

powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools/xlsx_to_json.ps1') `
  -Path $issuesPath -Out (Join-Path $root 'data/src/report_issue.json')

Write-Output "Rebuilding data/dataset.js ..."
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools/build_dataset.ps1') `
  -MonitoringJson (Join-Path $root 'data/src/monitoring.json') `
  -IssuesJson (Join-Path $root 'data/src/report_issue.json') `
  -Out (Join-Path $root 'data/dataset.js') `
  -MonitoringFile $sources.monitoring.label `
  -IssuesFile $sources.issues.label `
  -MonitoringStamp $MonitoringStamp `
  -IssuesStamp $IssuesStamp
