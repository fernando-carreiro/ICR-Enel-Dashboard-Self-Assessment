param(
  [string]$MonitoringJson = 'data/src/monitoring.json',
  [string]$IssuesJson = 'data/src/report_issue.json',
  [string]$Out = 'data/dataset.js',
  [string]$MonitoringFile = 'Monitoring.05_11_2026.xlsx',
  [string]$MonitoringStamp = '2026-11-05T12:52:28Z',
  [string]$IssuesFile = 'issue Report.05_11_2026.xlsx',
  [string]$IssuesStamp = '2026-11-05T13:25:59Z',
  [string]$Semester = ('2' + [char]0x00BA + ' semestre 2026')
)

$ErrorActionPreference = 'Stop'

function Normalize([string]$s) {
  if (-not $s) { return '' }
  $d = $s.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $d.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$sb.Append($ch)
    }
  }
  return $sb.ToString().ToLowerInvariant().Trim()
}

function Load-Sheet([string]$path) {
  $raw = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
  return @($raw.PSObject.Properties | ForEach-Object { $_.Value })
}

function Build-HeaderMap($rows) {
  $headerRow = $rows | Where-Object { $_.r -eq 1 } | Select-Object -First 1
  $map = @{}
  foreach ($p in $headerRow.cells.PSObject.Properties) {
    $key = Normalize ([string]$p.Value)
    if ($key -and -not $map.ContainsKey($key)) { $map[$key] = $p.Name }
  }
  return $map
}

function Find-Col($map, [string[]]$candidates) {
  foreach ($c in $candidates) {
    $k = Normalize $c
    if ($map.ContainsKey($k)) { return $map[$k] }
  }
  return $null
}

# ---------- monitoring ----------
$mRows = Load-Sheet $MonitoringJson
$mMap = Build-HeaderMap $mRows

$cols = [ordered]@{
  code      = Find-Col $mMap @('Codigo De Controle')
  desc      = Find-Col $mMap @('Descricao Controle (Lingua Local)', 'Descricao Controle (Idioma Ingles)')
  freq      = Find-Col $mMap @('Frequencia (Lingua Local)', 'Frequencia (Idioma Ingles)')
  owners    = Find-Col $mMap @('Control Owner')
  structure = Find-Col $mMap @('Estrutura Organizacional')
  status    = Find-Col $mMap @('Self-Assessment result')
  task      = Find-Col $mMap @('User managing task')
  esg       = Find-Col $mMap @('Controle ESG')
  country   = Find-Col $mMap @('Country')
  evidence  = Find-Col $mMap @('Prova Descricao (Lingua Local)', 'Prova Descricao (Idioma Ingles)')
}

foreach ($k in $cols.Keys) {
  if (-not $cols[$k]) { throw "Coluna obrigatoria nao encontrada no Monitoring: $k" }
}

# ---------- report issue ----------
$iRows = Load-Sheet $IssuesJson
$iMap = Build-HeaderMap $iRows
$iCols = [ordered]@{
  code    = Find-Col $iMap @('Codigo De Controle')
  status  = Find-Col $iMap @('Issue Status')
  name    = Find-Col $iMap @('Issue Name')
  owner   = Find-Col $iMap @('Control Owner/Tester Name')
  holding = Find-Col $iMap @('ICR Holding Name')
  due     = Find-Col $iMap @('Due Date')
  cluster = Find-Col $iMap @('Change Cluster')
  div     = Find-Col $iMap @('ICR Divisional Name')
  val     = Find-Col $iMap @('ICR Divisional validation details')
  appr    = Find-Col $iMap @('ICR Holding approval details')
  assess  = Find-Col $iMap @('Control Owner assessment details')
  ask     = Find-Col $iMap @('Deficiency Description (Local Language)', 'Deficiency Description (English Laguage)')
}

# Datas chegam como serial do Excel (46308) ou como texto (25.09.2026 13:57:48).
# Guardamos sempre yyyy-MM-dd para o front calcular dias sem depender de fuso.
function Convert-ToIsoDay([string]$value) {
  if (-not $value) { return '' }
  $s = ([string]$value).Trim()
  if (-not $s) { return '' }
  if ($s -match '^\d+(\.\d+)?$') {
    try {
      $oa = [double]::Parse($s, [Globalization.CultureInfo]::InvariantCulture)
      if ($oa -gt 20000 -and $oa -lt 90000) {
        return [datetime]::FromOADate($oa).ToString('yyyy-MM-dd')
      }
    } catch { }
    return ''
  }
  $formats = @('dd.MM.yyyy HH:mm:ss', 'd.M.yyyy H:mm:ss', 'dd.MM.yyyy', 'd.M.yyyy',
    'dd/MM/yyyy HH:mm:ss', 'd/M/yyyy H:mm:ss', 'dd/MM/yyyy', 'd/M/yyyy',
    'yyyy-MM-ddTHH:mm:ss', 'yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd')
  # Um formato por vez: passar o array direto deixa o PowerShell coagir para
  # string e cair num TryParse por cultura, que troca dia e mes.
  foreach ($f in $formats) {
    $parsed = [datetime]::MinValue
    if ([datetime]::TryParseExact($s, $f, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$parsed)) {
      return $parsed.ToString('yyyy-MM-dd')
    }
  }
  return ''
}

$issuesByCode = @{}
foreach ($row in $iRows) {
  if ($row.r -le 1) { continue }
  $code = [string]$row.cells.($iCols.code)
  if (-not $code) { continue }
  if ($issuesByCode.ContainsKey($code)) { continue }
  $ask = ([string]$row.cells.($iCols.ask)).Trim()
  if ($ask.Length -gt 400) { $ask = $ask.Substring(0, 400).Trim() + '...' }

  $issuesByCode[$code] = [ordered]@{
    st = [string]$row.cells.($iCols.status)
    ow = [string]$row.cells.($iCols.owner)
    hd = [string]$row.cells.($iCols.holding)
    du = [string]$row.cells.($iCols.due)
    cl = [string]$row.cells.($iCols.cluster)
    dn = ([string]$row.cells.($iCols.div)).Trim()
    vd = Convert-ToIsoDay ([string]$row.cells.($iCols.val))
    ap = Convert-ToIsoDay ([string]$row.cells.($iCols.appr))
    co = Convert-ToIsoDay ([string]$row.cells.($iCols.assess))
    dc = $ask
  }
}

# ---------- controls (Brazil) ----------
$controls = New-Object System.Collections.Generic.List[object]
$seen = @{}
$skipped = 0

foreach ($row in $mRows) {
  if ($row.r -le 1) { continue }
  $c = $row.cells
  $country = [string]$c.($cols.country)
  if ((Normalize $country) -ne 'brazil') { continue }

  # Estruturas de teste da planilha (ORG.DUMMY) nao entram no dashboard.
  if ((Normalize ([string]$c.($cols.structure))) -like 'org.dummy*') { continue }

  $code = ([string]$c.($cols.code)).Trim()
  if (-not $code) { $skipped++; continue }
  if ($seen.ContainsKey($code)) { $skipped++; continue }
  $seen[$code] = $true

  $owners = @()
  foreach ($o in (([string]$c.($cols.owners)) -split ';')) {
    $t = $o.Trim()
    if ($t) { $owners += $t }
  }

  $task = ([string]$c.($cols.task)).Trim()
  if ((Normalize $task) -eq 'non pianificato') { $task = '' }

  $evidence = ([string]$c.($cols.evidence)).Trim()
  if ($evidence.Length -gt 700) { $evidence = $evidence.Substring(0, 700).Trim() + '...' }

  $obj = [ordered]@{
    c = $code
    d = ([string]$c.($cols.desc)).Trim()
    f = ([string]$c.($cols.freq)).Trim()
    o = ($owners -join '; ')
    s = ([string]$c.($cols.structure)).Trim()
    r = ([string]$c.($cols.status)).Trim()
    t = $task
    e = $(if (([string]$c.($cols.esg)).Trim() -ne '') { 1 } else { 0 })
  }
  # A descricao da prova so e usada no painel de SA1: guardar apenas para eles.
  if ($obj['r'] -eq 'SA1') { $obj['p'] = $evidence }
  if ($issuesByCode.ContainsKey($code)) { $obj['i'] = $issuesByCode[$code] }

  $controls.Add($obj)
}

$payload = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  semester    = $Semester
  monitoring  = [ordered]@{ file = $MonitoringFile; modified = $MonitoringStamp }
  issues      = [ordered]@{ file = $IssuesFile; modified = $IssuesStamp }
  controls    = $controls
}

$json = $payload | ConvertTo-Json -Depth 6 -Compress

# escape non-ascii so the file is encoding independent
$escaped = [regex]::Replace($json, '[^\x00-\x7F]', {
  param($m)
  $ch = $m.Value[0]
  return ('\u{0:x4}' -f [int][char]$ch)
})

$full = [System.IO.Path]::GetFullPath($Out)
$text = "window.ICR_DATA = $escaped;`n"
[System.IO.File]::WriteAllText($full, $text, (New-Object System.Text.UTF8Encoding($false)))

$byStatus = $controls | Group-Object { $_.r } | Sort-Object Count -Descending
Write-Output ("controls: {0}  (skipped: {1})  with issue: {2}" -f $controls.Count, $skipped, (@($controls | Where-Object { $_.Contains('i') }).Count))
foreach ($g in $byStatus) { Write-Output ("  {0}: {1}" -f $g.Name, $g.Count) }
Write-Output ("output: {0} ({1:N0} bytes)" -f $Out, $text.Length)
