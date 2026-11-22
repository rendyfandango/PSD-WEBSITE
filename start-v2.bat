@echo off
setlocal
cd /d "%~dp0"
set PORT=8001

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo [!] Python tidak ditemukan.
    echo     Install Python 3 terlebih dahulu, atau jalankan static server lain
    echo     dari folder ini, misalnya: npx serve .
    pause
    exit /b 1
  )
  set PY=py
) else (
  set PY=python
)

echo ============================================================
echo  Music Analyzer v2
echo  Server lokal : http://localhost:%PORT%
echo  Hentikan     : Ctrl+C
echo ============================================================
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:%PORT%/'"
%PY% -m http.server %PORT%
endlocal
