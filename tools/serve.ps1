param(
  [int]$Port = 8123,
  [string]$Root = '.',
  # Origens extras autorizadas a chamar a API (dominio proprio no Netlify).
  # Por padrao valem http://127.0.0.1 e qualquer *.netlify.app.
  [string[]]$AllowOrigin = @()
)

$ErrorActionPreference = 'Stop'
$rootFull = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Root))
$cacheDir = Join-Path $rootFull '.cache'
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir | Out-Null }
$statePath = Join-Path $cacheDir 'refresh.json'
$lockPath = Join-Path $cacheDir 'refresh.lock'
$refreshScript = Join-Path $rootFull 'tools/refresh.ps1'

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Output (("Serving {0} at http://127.0.0.1:{1}/") -f $rootFull, $Port)

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
}

# A pagina publicada no Netlify (https) chama esta API na propria maquina, entao
# a resposta precisa de CORS. Apenas origens do Netlify e o localhost sao
# aceitas, para que outro site aberto no navegador nao consiga disparar nem ler
# a atualizacao.
function Get-AllowedOrigin([string]$origin) {
  if (-not $origin) { return '' }
  if ($AllowOrigin -contains $origin) { return $origin }
  try { $uri = [System.Uri]$origin } catch { return '' }
  if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') { return '' }
  $h = $uri.Host.ToLowerInvariant()
  if ($h -eq 'netlify.app' -or $h.EndsWith('.netlify.app')) { return $origin }
  if ($h -eq 'localhost' -or $h -eq '127.0.0.1' -or $h -eq '::1') { return $origin }
  return ''
}

function Get-CorsHeaders([string]$origin, [string]$privateNetwork) {
  if (-not $origin) { return '' }
  $h = "Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`n" +
    "Access-Control-Allow-Methods: GET, POST, OPTIONS`r`n" +
    "Access-Control-Allow-Headers: Content-Type`r`n" +
    "Access-Control-Max-Age: 600`r`n"
  if ($privateNetwork -eq 'true') { $h += "Access-Control-Allow-Private-Network: true`r`n" }
  return $h
}

function Write-Head($stream, [string]$status, [string]$contentType, [int]$length, [string]$origin, [string]$privateNetwork) {
  $head = "HTTP/1.1 $status`r`nContent-Type: $contentType`r`nContent-Length: $length`r`n" +
    (Get-CorsHeaders $origin $privateNetwork) +
    "Cache-Control: no-store`r`nConnection: close`r`n`r`n"
  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($headBytes, 0, $headBytes.Length)
  $stream.Flush()
}

function Send-Response($stream, [string]$status, [string]$contentType, [byte[]]$body, [string]$origin) {
  Write-Head $stream $status $contentType $body.Length $origin ''
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

function Text-Body([string]$text) {
  return [System.Text.Encoding]::UTF8.GetBytes($text)
}

function Read-RefreshState {
  if (Test-Path -LiteralPath $statePath) {
    try {
      $raw = [System.IO.File]::ReadAllText($statePath, [System.Text.Encoding]::UTF8)
      if ($raw.Trim()) { return $raw }
    } catch { }
  }
  return '{"state":"idle","message":""}'
}

function Get-RequestHeaders([string[]]$lines) {
  $headers = @{}
  foreach ($line in $lines) {
    $idx = $line.IndexOf(':')
    if ($idx -gt 0) {
      $name = $line.Substring(0, $idx).Trim().ToLowerInvariant()
      $headers[$name] = $line.Substring($idx + 1).Trim()
    }
  }
  return $headers
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000
    $buffer = New-Object byte[] 8192
    $sb = New-Object System.Text.StringBuilder
    do {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buffer, 0, $read))
    } while ($sb.ToString() -notmatch "`r`n`r`n")

    $lines = $sb.ToString() -split "`r`n"
    $requestLine = $lines[0]
    $parts = $requestLine -split ' '
    $method = $parts[0]
    $rawPath = if ($parts.Length -gt 1) { $parts[1] } else { '/' }
    $path = [System.Uri]::UnescapeDataString(($rawPath -split '\?')[0])
    if ($path -eq '/') { $path = '/index.html' }

    $headers = Get-RequestHeaders $lines
    $origin = Get-AllowedOrigin $headers['origin']

    if ($method -eq 'OPTIONS') {
      # Preflight do navegador para https -> http://127.0.0.1 (Private Network
      # Access): libera o metodo, os headers e a propria rede local.
      Write-Head $stream '204 No Content' 'text/plain; charset=utf-8' 0 $origin $headers['access-control-request-private-network']
      continue
    }

    # ---------------- API de atualizacao ----------------

    if ($path -eq '/api/refresh/state') {
      Send-Response $stream '200 OK' 'application/json; charset=utf-8' (Text-Body (Read-RefreshState)) $origin
      continue
    }

    if ($path -eq '/api/refresh') {
      if ($method -ne 'POST') {
        Send-Response $stream '405 Method Not Allowed' 'application/json; charset=utf-8' (Text-Body '{"state":"error","message":"use POST"}') $origin
        continue
      }
      $busy = $false
      if (Test-Path -LiteralPath $lockPath) {
        $age = (Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime
        if ($age.TotalSeconds -lt 240) { $busy = $true }
      }
      if ($busy) {
        $current = Read-RefreshState
        Send-Response $stream '409 Conflict' 'application/json; charset=utf-8' (Text-Body $current) $origin
        continue
      }
      [System.IO.File]::WriteAllText($statePath, '{"state":"starting","message":"Iniciando verificacao..."}',
        (New-Object System.Text.UTF8Encoding($false)))
      New-Item -ItemType File -Path $lockPath -Force | Out-Null
      try {
        # O caminho tem espaco ("Dashboard SA1"): precisa de aspas no -File.
        $scriptArg = '"' + $refreshScript + '"'
        Start-Process -FilePath 'powershell' -WindowStyle Hidden -ArgumentList @(
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptArg
        ) | Out-Null
        Send-Response $stream '202 Accepted' 'application/json; charset=utf-8' (Text-Body '{"state":"started","message":""}') $origin
      } catch {
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
        $msg = ([string]$_.Exception.Message) -replace '"', "''"
        [System.IO.File]::WriteAllText($statePath, '{"state":"error","message":"' + $msg + '"}',
          (New-Object System.Text.UTF8Encoding($false)))
        Send-Response $stream '500 Internal Server Error' 'application/json; charset=utf-8' (Text-Body '{"state":"error","message":"nao foi possivel iniciar"}') $origin
      }
      continue
    }

    # ---------------- arquivos ----------------

    $relative = $path.TrimStart('/') -replace '/', [System.IO.Path]::DirectorySeparatorChar
    $file = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relative))

    if (-not $file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      Send-Response $stream '403 Forbidden' 'text/plain; charset=utf-8' (Text-Body 'Forbidden') $origin
    } elseif ($path.StartsWith('/.cache')) {
      # perfil do navegador auxiliar e arquivos de estado nao sao publicados
      Send-Response $stream '403 Forbidden' 'text/plain; charset=utf-8' (Text-Body 'Forbidden') $origin
    } elseif ($method -ne 'GET') {
      Send-Response $stream '405 Method Not Allowed' 'text/plain; charset=utf-8' (Text-Body 'Method not allowed') $origin
    } elseif (Test-Path -LiteralPath $file -PathType Leaf) {
      $body = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $contentType = 'text/plain; charset=utf-8'
      if ($types.ContainsKey($ext)) { $contentType = $types[$ext] }
      # o dataset servido aqui tambem e lido pela pagina publicada no Netlify
      Send-Response $stream '200 OK' $contentType $body $origin
    } else {
      Send-Response $stream '404 Not Found' 'text/plain; charset=utf-8' (Text-Body 'Not found') $origin
    }
  } catch {
    # ignore malformed requests
  } finally {
    $client.Close()
  }
}
