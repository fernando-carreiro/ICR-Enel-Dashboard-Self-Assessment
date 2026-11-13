# Verifica as pastas do SharePoint (Monitoring e Report Issue), baixa as
# planilhas mais recentes quando mudaram e reconstroi data/dataset.js.
#
# Como o SharePoint nao aceita acesso sem sessao (sem WIA, sem CORS), o script
# usa o Edge instalado na maquina com um perfil proprio (.cache/sp-edge): se a
# sessao ainda nao existir, abre uma janela para o login; depois disso as
# consultas acontecem em modo headless.
#
# O progresso e publicado em .cache/refresh.json, lido pelo servidor local e
# pela tela do dashboard.
param(
  [int]$Port = 9333,
  # 0 = mes do sistema; 1..12 forca um mes (util para testar a troca de pasta).
  [int]$Month = 0,
  [string]$Site = 'https://enelcom.sharepoint.com/sites/ICFRBrasil',
  [switch]$Debug,
  [switch]$Explore
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $root '.cache'
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
$statePath = Join-Path $cacheDir 'refresh.json'
$lockPath = Join-Path $cacheDir 'refresh.lock'
$profileDir = Join-Path $cacheDir 'sp-edge'
$sourcesPath = Join-Path $root 'data/sources.json'
$rawDir = Join-Path $root 'data/raw'

function Save-State([string]$state, [string]$message) {
  $obj = [ordered]@{
    state   = $state
    message = $message
    at      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  }
  $json = $obj | ConvertTo-Json -Depth 4 -Compress
  [System.IO.File]::WriteAllText($statePath, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Find-Edge {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Get-EdgePids {
  return @(Get-Process -Name msedge -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
}

# Encerra apenas os processos do Edge que usam o perfil auxiliar deste projeto.
function Clear-AuxEdge {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) })
  foreach ($p in $procs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
  }
  if ($procs.Count -gt 0) { Start-Sleep -Milliseconds 900 }
}

$edge = Find-Edge
if (-not $edge) {
  Save-State 'error' 'Microsoft Edge nao encontrado nesta maquina.'
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  exit 1
}

function Start-Edge([bool]$headless) {
  $arguments = @(
    "--remote-debugging-port=$Port",
    '--remote-allow-origins=*',
    ('--user-data-dir="' + $profileDir + '"'),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--window-size=1280,900'
  )
  if ($headless) { $arguments += '--headless=new' }
  $arguments += $Site
  return (Start-Process -FilePath $edge -ArgumentList $arguments -PassThru)
}

function Wait-Cdp([int]$tries = 60) {
  for ($i = 0; $i -lt $tries; $i++) {
    try {
      return (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2)
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }
  return $null
}

function Send-Text($ws, [string]$text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$bytes)
  $task = $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None)
  if (-not $task.Wait(60000)) { throw 'timeout enviando comando ao navegador' }
}

function Receive-Text($ws) {
  $buffer = New-Object byte[] 131072
  $ms = New-Object System.IO.MemoryStream
  $end = $false
  $result = $null
  while (-not $end) {
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$buffer)
    $task = $ws.ReceiveAsync($seg, [System.Threading.CancellationToken]::None)
    if (-not $task.Wait(180000)) { throw 'timeout lendo do navegador' }
    $result = $task.Result
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw 'conexao fechada pelo navegador' }
    $ms.Write($buffer, 0, $result.Count)
    $end = $result.EndOfMessage
  }
  return [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
}

$script:cdpId = 0

function Invoke-Cdp($ws, [string]$method, $params) {
  $script:cdpId++
  $id = $script:cdpId
  $payload = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 8 -Compress
  Send-Text $ws $payload
  while ($true) {
    $raw = Receive-Text $ws
    $msg = $raw | ConvertFrom-Json
    if ($msg.id -ne $id) { continue }
    if ($msg.PSObject.Properties.Name -contains 'error') { throw ('navegador: ' + $msg.error.message) }
    return $msg.result
  }
}

function Invoke-Js($ws, [string]$expression) {
  $res = Invoke-Cdp $ws 'Runtime.evaluate' @{ expression = $expression; awaitPromise = $true; returnByValue = $true }
  if ($res.PSObject.Properties.Name -contains 'exceptionDetails') {
    $detail = $res.exceptionDetails.text
    if ($res.exceptionDetails.PSObject.Properties.Name -contains 'exception') {
      $detail += ' ' + $res.exceptionDetails.exception.description
    }
    throw ('script no navegador: ' + $detail)
  }
  return $res.result.value
}

function Connect-Cdp {
  $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5
  $wsUrl = ''
  foreach ($t in @($targets)) {
    if (-not $t) { continue }
    if ($t.type -ne 'page') { continue }
    $candidate = [string]$t.webSocketDebuggerUrl
    if ($candidate) { $wsUrl = $candidate; break }
  }
  if (-not $wsUrl) { throw 'nenhuma aba do navegador disponivel' }
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(5)
  $uri = New-Object System.Uri($wsUrl)
  $connect = $ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None)
  if (-not $connect.Wait(20000)) { throw 'nao foi possivel falar com o navegador' }
  return $ws
}

function Convert-IsoDay([string]$value) {
  if (-not $value) { return $null }
  $styles = [System.Globalization.DateTimeStyles]::AdjustToUniversal -bor [System.Globalization.DateTimeStyles]::AssumeUniversal
  try {
    return [datetime]::Parse([string]$value, [System.Globalization.CultureInfo]::InvariantCulture, $styles)
  } catch { return $null }
}

function Safe-FileName([string]$name) {
  $n = [string]$name
  $n = $n -replace '\s+', '_'
  $n = $n -replace '[^A-Za-z0-9_.-]', ''
  return $n.ToLowerInvariant()
}

# As pastas de mes nao seguem um padrao unico no SharePoint ("11. November",
# "08.August", "November", "Out"), entao o mes corrente e resolvido pelo nome.
$MonthWords = @{
  1 = @('january', 'janeiro', 'jan');            2 = @('february', 'fevereiro', 'feb', 'fev')
  3 = @('march', 'marco', 'mar');                4 = @('april', 'abril', 'apr', 'abr')
  5 = @('may', 'maio', 'mai');                   6 = @('june', 'junho', 'jun')
  7 = @('july', 'julho', 'jul');                 8 = @('august', 'agosto', 'aug', 'ago')
  9 = @('september', 'setembro', 'sep', 'set'); 10 = @('october', 'outubro', 'oct', 'out')
  11 = @('november', 'novembro', 'nov');        12 = @('december', 'dezembro', 'dec', 'dez')
}

function Get-MonthLabel([int]$m) {
  $pt = [System.Globalization.CultureInfo]::GetCultureInfo('pt-BR')
  return ([datetime]::new(2024, $m, 1)).ToString('MMMM', $pt)
}

# "11. November" / "08.August" / "Out" -> "november" / "august" / "out"
function ConvertTo-NameKey([string]$text) {
  $d = $text.Normalize([System.Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $d.ToCharArray()) {
    if (-not $ch) { continue }
    if ([System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -eq [System.Globalization.UnicodeCategory]::NonSpacingMark) { continue }
    if ([char]::IsLetter($ch)) { [void]$sb.Append([char]::ToLowerInvariant($ch)) }
  }
  return $sb.ToString()
}

function Get-EffectiveMonth {
  if ($script:Month -ge 1 -and $script:Month -le 12) { return [int]$script:Month }
  return (Get-Date).Month
}

function Get-MonthFolderName($names, [int]$month) {
  foreach ($n in @($names)) {
    if ($MonthWords[$month] -contains (ConvertTo-NameKey ([string]$n))) { return [string]$n }
  }
  return $null
}

# Sessao expirada: abre a janela visivel do Edge, espera o login e segue.
function Start-SpLogin {
  if ($script:ws) { try { $script:ws.Dispose() } catch { }; $script:ws = $null }
  Clear-AuxEdge
  Save-State 'need-login' 'A sessao do SharePoint expirou. Entre na janela que abriu: a atualizacao continua sozinha.'
  [void](Start-Edge $false)
  $script:ownsBrowser = $true
  $script:startedPids = @()
  if (-not (Wait-Cdp 60)) { throw 'o navegador auxiliar nao abriu a porta de depuracao' }
  Start-Sleep -Milliseconds 1500
  $script:ws = Connect-Cdp
  $helper = Get-Content (Join-Path $PSScriptRoot 'sharepoint.js') -Raw -Encoding UTF8
  $authed = $false
  for ($i = 0; $i -lt 100; $i++) {   # ate ~5 minutos de espera pelo login
    Start-Sleep -Seconds 3
    try {
      [void](Invoke-Js $script:ws $helper)
      $who = Invoke-Js $script:ws ('window.__SP.auth(' + $script:siteJson + ')')
      if ($who -and $who.ok) { $authed = $true; break }
    } catch {
      # a pagina trocou durante o login: reconecta a aba atual
      try { $script:ws.Dispose() } catch { }
      try { $script:ws = Connect-Cdp } catch { }
    }
  }
  if (-not $authed) { throw 'a sessao do SharePoint nao foi concluida a tempo' }
}

# Troca a pasta fixa do mes pela pasta do mes corrente (ou do anterior, se a do
# mes ainda nao existir no SharePoint). Ano e semestre tambem acompanham a data.
function Resolve-MonthFolders {
  $now = Get-Date
  $month = Get-EffectiveMonth
  $prev = if ($month -eq 1) { 12 } else { $month - 1 }
  $sem = if ($month -le 6) { 'I' } else { 'II' }

  foreach ($t in $targets) {
    $stored = [string]$t.parent
    if (-not $stored) { $stored = ([string]$t.rel) -replace '/[^/]+$', '' }

    $candidates = @()
    $auto = ($stored -replace '01_Year \d{4}', ('01_Year ' + $now.Year)) `
      -replace '[IVX]+ SEM \d{4}', ($sem + ' SEM ' + $now.Year)
    if ($auto -ne $stored) { $candidates += $auto }
    $candidates += $stored

    $hit = $null
    foreach ($parent in $candidates) {
      if (-not $parent) { continue }
      $sub = Invoke-Js $ws ('window.__SP.folders(' + $siteJson + ', ' + ($parent | ConvertTo-Json -Compress) + ')')
      if (-not $sub -or -not $sub.ok) { continue }
      $name = Get-MonthFolderName $sub.names $month
      $used = $month
      if (-not $name) { $name = Get-MonthFolderName $sub.names $prev; $used = $prev }
      if ($name) { $hit = [ordered]@{ parent = $parent; name = $name; month = $used }; break }
    }
    if (-not $hit) {
      throw ('nao encontrei a pasta de ' + (Get-MonthLabel $month) + ' em ' + $stored)
    }
    $t.parent = $hit.parent
    $t.rel = $hit.parent + '/' + $hit.name
    $t.month = $hit.month
  }
}

$startedPids = @()
$ws = $null
$exitCode = 0

try {
  Save-State 'checking' 'Consultando as pastas do SharePoint...'

  $sources = Get-Content $sourcesPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $targets = @(
    [ordered]@{ key = 'monitoring'; parent = [string]$sources.monitoring.parent; rel = [string]$sources.monitoring.folder; month = 0 },
    [ordered]@{ key = 'issues'; parent = [string]$sources.issues.parent; rel = [string]$sources.issues.folder; month = 0 }
  )

  $existing = $null
  try { $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 } catch { $existing = $null }

  $ownsBrowser = $false
  if (-not $existing) {
    Clear-AuxEdge
    $before = Get-EdgePids
    [void](Start-Edge $true)
    $ownsBrowser = $true
    if (-not (Wait-Cdp 60)) { throw 'o navegador auxiliar nao abriu a porta de depuracao' }
    Start-Sleep -Milliseconds 500
    $after = Get-EdgePids
    $startedPids = @($after | Where-Object { $before -notcontains $_ })
    Start-Sleep -Milliseconds 1200
  }

  $ws = Connect-Cdp

  # Garante que o fetch sai da origem do SharePoint (cookies da sessao).
  [void](Invoke-Cdp $ws 'Page.navigate' @{ url = $Site })
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 400
    $ready = $null
    try { $ready = Invoke-Js $ws 'document.readyState' } catch { $ready = $null }
    if ($ready -eq 'complete') { break }
  }

  $helper = Get-Content (Join-Path $PSScriptRoot 'sharepoint.js') -Raw -Encoding UTF8
  [void](Invoke-Js $ws $helper)

  if ($Explore) {
    $expr = Get-Content (Join-Path $cacheDir 'sp_expr.js') -Raw -Encoding UTF8
    $probe = Invoke-Js $ws $expr
    [System.IO.File]::WriteAllText((Join-Path $cacheDir 'explore.json'), [string]$probe, (New-Object System.Text.UTF8Encoding($false)))
    Save-State 'same' 'exploracao concluida'
    return
  }

  $siteJson = $Site | ConvertTo-Json -Compress

  # Sem sessao o proprio script abre a janela e espera o login (o botao do
  # dashboard nao precisa de um segundo clique).
  $who = Invoke-Js $ws ('window.__SP.auth(' + $siteJson + ')')
  if (-not $who.ok) {
    Start-SpLogin
    Save-State 'checking' 'Sessao confirmada. Buscando as planilhas...'
  }

  Resolve-MonthFolders
  Save-State 'checking' ('Consultando as pastas de ' + (Get-MonthLabel (Get-EffectiveMonth)) + ' no SharePoint...')

  $rels = @($targets | ForEach-Object { $_.rel })
  $relsJson = '["' + (($rels | ForEach-Object { $_ -replace '"', '\"' }) -join '","') + '"]'
  $listing = Invoke-Js $ws ('window.__SP.list(' + $siteJson + ', ' + $relsJson + ')')

  if (-not $listing.ok -and $listing.auth -eq $false) {
    Start-SpLogin
    Save-State 'checking' 'Sessao confirmada. Buscando as planilhas...'
    $listing = Invoke-Js $ws ('window.__SP.list(' + $siteJson + ', ' + $relsJson + ')')
    if (-not $listing.ok) {
      throw ('nao foi possivel ler as pastas do SharePoint: ' + $listing.status)
    }
  }
  if ($Debug) {
    $dump = Join-Path $cacheDir 'listing.json'
    [System.IO.File]::WriteAllText($dump, ($listing | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
  }
  if (-not $listing.ok) {
    throw ('nao foi possivel ler as pastas do SharePoint: ' + $listing.status)
  }

  $changes = @()
  foreach ($t in $targets) {
    $folder = $listing.folders.PSObject.Properties[$t.rel]
    if (-not $folder) { continue }
    $files = @($folder.Value.files)
    if ($files.Count -eq 0) {
      throw ('nenhuma planilha encontrada em ' + $t.rel)
    }
    $newest = $files[0]
    $current = $sources.($t.key)
    $sameName = ([string]$newest.name).Trim().ToLowerInvariant() -eq ([string]$current.label).Trim().ToLowerInvariant()
    $newStamp = Convert-IsoDay $newest.modified
    $curStamp = Convert-IsoDay $current.modified
    $sameStamp = $false
    if ($newStamp -and $curStamp) {
      $sameStamp = [math]::Abs(($newStamp - $curStamp).TotalSeconds) -lt 2
    }
    $changes += [ordered]@{
      key      = $t.key
      label    = [string]$newest.name
      modified = [string]$newest.modified
      path     = [string]$newest.path
      rel      = $t.rel
      parent   = $t.parent
      changed  = (-not ($sameName -and $sameStamp))
      size     = [long]$newest.size
    }
  }

  $pending = @($changes | Where-Object { $_.changed })
  if ($pending.Count -eq 0) {
    $mon = $sources.monitoring
    $msg = 'As planilhas do SharePoint ja sao as carregadas (' + $mon.label + ' e ' + $sources.issues.label + ').'
    $stale = @($targets | Where-Object { $_.month -ne (Get-EffectiveMonth) })
    if ($stale.Count -gt 0) {
      $msg += ' A pasta do mes corrente ainda nao existe; usei ' + ($stale[0].rel -replace '^.*/', '') + '.'
    }
    Save-State 'same' $msg
    return
  }

  foreach ($c in $pending) {
    Save-State 'downloading' ('Baixando ' + $c.label + '...')
    $filePath = $c.path -replace '\\', '\\\\' -replace '"', '\"'
    $res = Invoke-Js $ws ('window.__SP.download(' + $siteJson + ', "' + $filePath + '")')
    if (-not $res.ok) {
      if ($res.login) {
        Save-State 'need-login' 'A sessao do SharePoint expirou. Entre na janela do navegador e clique de novo.'
        $exitCode = 2
        return
      }
      throw ('falha ao baixar ' + $c.label + ': HTTP ' + $res.status)
    }
    $bytes = [Convert]::FromBase64String($res.b64)
    $localName = Safe-FileName $c.label
    $dest = Join-Path $rawDir $localName
    [System.IO.File]::WriteAllBytes($dest, $bytes)

    $entry = $sources.($c.key)
    $entry.file = $localName
    $entry.label = $c.label
    if ($c.rel) { $entry.folder = $c.rel }
    if ($c.parent) { $entry.parent = $c.parent }
    $stamp = Convert-IsoDay $c.modified
    if ($stamp) { $entry.modified = $stamp.ToString('yyyy-MM-ddTHH:mm:ssZ') } else { $entry.modified = $c.modified }
  }

  $sourcesJson = $sources | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($sourcesPath, $sourcesJson, (New-Object System.Text.UTF8Encoding($false)))

  Save-State 'building' 'Reconstruindo o dataset...'
  # Start-Process evita que o stderr do build vire erro do PowerShell 5.1 (2>&1 + Stop).
  $logPath = Join-Path $cacheDir 'build.log'
  $buildScript = '"' + (Join-Path $PSScriptRoot 'build.ps1') + '"'
  $buildProc = Start-Process -FilePath 'powershell' -NoNewWindow -Wait -PassThru -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $buildScript
  ) -RedirectStandardOutput $logPath -RedirectStandardError ($logPath + '.err')
  $buildCode = $buildProc.ExitCode
  $buildLines = @()
  if (Test-Path -LiteralPath $logPath) { $buildLines = @(Get-Content -LiteralPath $logPath) }
  if ($buildCode -ne 0) {
    $errLines = @()
    if (Test-Path -LiteralPath ($logPath + '.err')) { $errLines = @(Get-Content -LiteralPath ($logPath + '.err')) }
    $tailErr = (($errLines + $buildLines) | Where-Object { $_.Trim() } | Select-Object -Last 4) -join ' '
    throw ('falha na reconstrucao (' + $buildCode + '): ' + $tailErr)
  }
  $tail = ($buildLines | Where-Object { $_.Trim() } | Select-Object -Last 1)
  Save-State 'updated' ('Dataset atualizado. ' + $tail)
} catch {
  $line = $_.InvocationInfo.ScriptLineNumber
  Save-State 'error' (([string]$_.Exception.Message) + ' (linha ' + $line + ')')
  $exitCode = 1
} finally {
  if ($ws) { try { $ws.Dispose() } catch { } }
  if ($ownsBrowser) { Clear-AuxEdge }
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}

exit $exitCode
