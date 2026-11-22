@echo off
echo Menghentikan server Music Analyzer pada port 8000 dan 8001...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8000,8001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
echo Selesai.
