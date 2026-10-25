@echo off
setlocal
cd /d "%~dp0"
python -c "import fastapi, uvicorn, multipart, yaml, jsonschema" >nul 2>&1
if errorlevel 1 (
  echo Required Python modules are unavailable. See README.txt for prerequisites.
  pause
  exit /b 1
)
echo Open Chart Editor: http://127.0.0.1:8766
echo Close this window or press Ctrl+C to stop the local preview.
python dev_server.py
