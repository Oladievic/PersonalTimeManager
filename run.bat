@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo.
  echo Не найден Python 3. Установите его с https://www.python.org/downloads/
  echo При установке отметьте "Add Python to PATH".
  echo.
  pause
  exit /b 1
)

if not exist "data" mkdir "data"
echo.
echo Запускаю «Пробку» на http://localhost:8765/
echo Токен для MCP будет показан ниже. Окно не закрывайте, пока работаете.
echo.
%PY% server.py --port 8765 --open
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo.
  echo Сервер завершился с кодом %CODE%.
  pause
)
endlocal
