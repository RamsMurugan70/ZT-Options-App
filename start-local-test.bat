@echo off
setlocal
set "APP_ROOT=%~dp0"
set "SERVER_DIR=%APP_ROOT%server"
set "CLIENT_DIR=%APP_ROOT%client"

echo Starting ZT-Options-App local test setup...
echo Backend:  http://localhost:5002
echo Frontend: http://127.0.0.1:5175
echo.

start "ZT-Options Backend 5002" /MIN cmd /k "cd /d "%SERVER_DIR%" && set PORT=5002&& npm start"
timeout /t 3 /nobreak >nul

start "ZT-Options Frontend 5175" /MIN cmd /k "cd /d "%CLIENT_DIR%" && set VITE_API_TARGET=http://localhost:5002&& npm run dev -- --host 127.0.0.1 --port 5175"
timeout /t 5 /nobreak >nul

start "" "http://127.0.0.1:5175"

echo.
echo ZT-Options-App should now be open at http://127.0.0.1:5175
echo Leave the backend and frontend command windows running while testing.
pause
