@echo off
REM run.bat - launches the Hebrew Subtitles GUI app. First run: sets up automatically.
cd /d "%~dp0"
set VENV=.venv

if not exist "%VENV%\Scripts\pythonw.exe" (
  echo ============================================================
  echo First-time setup: creating environment and installing.
  echo This runs once and may take a few minutes. Please wait...
  echo ============================================================
  REM try 3.12, then 3.11, then any Python 3 — different machines have different versions installed
  py -3.12 -m venv "%VENV%" 2>nul || py -3.11 -m venv "%VENV%" 2>nul || py -3 -m venv "%VENV%"
  if errorlevel 1 (
    echo.
    echo Python 3.11 or 3.12 is required. Opening the download page...
    start "" "https://www.python.org/downloads/release/python-3120/"
    pause
    exit /b 1
  )
  "%VENV%\Scripts\python.exe" -m pip install --upgrade pip
  "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo Installation of dependencies failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  REM create a Desktop shortcut so launching is one double-click, no CMD
  "%VENV%\Scripts\python.exe" tools\make_shortcut.py
  REM register subsidekick:// so a Chrome bookmark can launch the app too
  "%VENV%\Scripts\python.exe" tools\register_protocol.py
  echo.
  echo Done! A "Subtitle Sidekick" icon was added to your Desktop.
) else (
  REM already set up: keep dependencies fresh so a pulled update's new requirements apply.
  REM Fast when nothing changed; silent so the launch still feels instant.
  "%VENV%\Scripts\python.exe" -m pip install -r requirements.txt --quiet --disable-pip-version-check
)

start "" "%~dp0%VENV%\Scripts\pythonw.exe" "%~dp0app.py"
