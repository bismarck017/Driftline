@echo off
REM Driftline multiplayer server - one-command start (Windows)
REM Installs dependencies on first run, then starts the server + public tunnel.
cd /d "%~dp0"
echo Starting the Driftline multiplayer server...

if not exist "node_modules\ws" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Node.js is required. Install it from https://nodejs.org and run this again.
    pause
    exit /b 1
  )
  echo    installing dependencies...
  call npm install --no-audit --no-fund --loglevel=error
)

node server.js
pause
