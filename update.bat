@echo off
REM update.bat - one-click update: downloads the latest version from GitHub and replaces the app code.
REM Your data (courses, lectures, settings) lives in %USERPROFILE%\Videos\Subtitle Sidekick and is NOT touched.
cd /d "%~dp0"
echo ============================================================
echo   Updating Subtitle Sidekick to the latest version...
echo   (your transcribed lectures and settings are safe)
echo ============================================================
echo.

REM 1) download the latest code as a zip from GitHub FIRST — only kill the app once we actually
REM    have a good download, so a failed download can't leave the app closed for nothing.
set "ZIP=%TEMP%\subsidekick-update.zip"
set "EXDIR=%TEMP%\subsidekick-update"
if exist "%EXDIR%" rmdir /s /q "%EXDIR%"
echo Downloading latest version...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://github.com/itaylot/subtitle-sidekick/archive/refs/heads/main.zip' -OutFile '%ZIP%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
  echo.
  echo Download failed - check your internet connection and try again.
  pause
  exit /b 1
)

REM 2) extract the download
echo Installing update...
powershell -NoProfile -Command "Expand-Archive -Path '%ZIP%' -DestinationPath '%EXDIR%' -Force"
if errorlevel 1 (
  echo.
  echo Could not extract the update. Please try again.
  pause
  exit /b 1
)
for /d %%D in ("%EXDIR%\*") do set "SRC=%%D"

REM 3) now that the update is ready, close the running app so its files can be replaced
taskkill /IM pythonw.exe /F >nul 2>&1

REM 4) copy over the current folder (code only; .venv, .git and user data untouched)
robocopy "%SRC%" "%~dp0." /E /XD .venv .git /XF library.json settings.json queue.json dictionary.json resume.json /NFL /NDL /NJH /NJS >nul
REM robocopy exit codes below 8 are success (files copied / nothing to do); 8+ is a real failure
if errorlevel 8 (
  echo.
  echo Copying the new files failed. Your app is unchanged - just relaunch it.
  pause
  exit /b 1
)

REM 4) refresh dependencies (in case requirements changed) and relaunch
echo Updating dependencies...
"%~dp0.venv\Scripts\python.exe" -m pip install -r requirements.txt --quiet --disable-pip-version-check

del "%ZIP%" >nul 2>&1
rmdir /s /q "%EXDIR%" >nul 2>&1
echo.
echo ============================================================
echo   Update complete! Restarting Subtitle Sidekick...
echo ============================================================
start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0app.py"
