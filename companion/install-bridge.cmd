@echo off
rem Double-click to install the bridge between the browser extension and the companion program.
rem Run "install-bridge.cmd uninstall" to remove it, or "install-bridge.cmd check" to see the state.
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 or newer is required. Install it from https://www.python.org/downloads/ and run this file again.
  pause
  exit /b 1
)
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=install"
rem Collect every argument after the action. %* would not do: it ignores shift and repeats the action.
set "REST="
shift
:collect
if "%~1"=="" goto run
set "REST=%REST% %1"
shift
goto collect
:run
python -m ai_subtitles_companion %ACTION%%REST%
set "RESULT=%errorlevel%"
echo.
pause
exit /b %RESULT%
