# Monta a pasta dist/ com o que o Netlify precisa publicar: a pagina, os assets
# e o dataset. Tools, planilhas cruas e .cache (perfil do navegador) ficam fora.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/pack.ps1
# Depois publique a pasta dist/ (arrastar em https://app.netlify.com/drop).

param(
  [string]$OutDir = 'dist'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root $OutDir

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null
New-Item -ItemType Directory -Path (Join-Path $out 'data') | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'index.html') -Destination $out
Copy-Item -LiteralPath (Join-Path $root 'assets') -Destination $out -Recurse
Copy-Item -LiteralPath (Join-Path $root 'data/dataset.js') -Destination (Join-Path $out 'data')

$files = @(Get-ChildItem -LiteralPath $out -Recurse -File)
$size = ($files | Measure-Object -Property Length -Sum).Sum

# 404 do Netlify volta para o dashboard em vez de uma pagina padrao.
$redirects = "/index.html  /index.html  200`n"
[System.IO.File]::WriteAllText((Join-Path $out '_redirects'), $redirects, (New-Object System.Text.UTF8Encoding($false)))

Write-Output ("dist pronto: {0} arquivos, {1:N0} KB" -f $files.Count, ($size / 1KB))
Get-ChildItem -LiteralPath $out -Recurse -File | ForEach-Object {
  Write-Output ("  " + $_.FullName.Substring($out.Length + 1) + " (" + [math]::Round($_.Length / 1KB) + " KB)")
}
