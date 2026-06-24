@echo off
REM run.bat - launches the Hebrew Subtitles GUI app. First run: sets up automatically.
cd /d "%~dp0"
set VENV=backend\.venv312

if not exist "%VENV%\Scripts\pythonw.exe" (
  echo ============================================================
  echo First-time setup: creating environment and installing.
  echo This runs once and may take a few minutes. Please wait...
  echo ============================================================
  py -3.12 -m venv "%VENV%"
  if errorlevel 1 (
    echo.
    echo Python 3.12 is required. Opening the download page...
    start "" "https://www.python.org/downloads/release/python-3120/"
    pause
    exit /b 1
  )
  "%VENV%\Scripts\python.exe" -m pip install --upgrade pip
  "%VENV%\Scripts\python.exe" -m pip install -r backend\requirements.txt
)

start "" "%~dp0%VENV%\Scripts\pythonw.exe" "%~dp0app.py"
