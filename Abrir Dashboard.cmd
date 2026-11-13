@echo off
setlocal
set PORT=8123

rem Se o servidor ja estiver no ar, nao sobe outro.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:%PORT%/api/refresh/state') -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0tools\serve.ps1\" -Port %PORT%'"
  timeout /t 3 /nobreak >nul
)

start "" "http://127.0.0.1:%PORT%/index.html"
