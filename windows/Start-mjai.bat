@echo off
setlocal
cd /d "%~dp0"
set "PYTHONHOME=%~dp0runtime\python"
set "PYTHONNOUSERSITE=1"
set "PYTHONPATH="
set "PYTHONUSERBASE="
set "PYTHONUTF8=1"
if not exist "%~dp0runtime\python\python.exe" (
  echo Missing runtime. Please copy the complete mjai Windows folder.
  pause
  exit /b 1
)
"%~dp0runtime\python\python.exe" "%~dp0launcher.py" %*
if errorlevel 1 pause
endlocal
