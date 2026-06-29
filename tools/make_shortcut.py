"""make_shortcut.py — creates a "Subtitle Sidekick" desktop shortcut.

Called once by run.bat after installation so the app can be launched from the icon without CMD.
"""

import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYW = os.path.join(ROOT, ".venv", "Scripts", "pythonw.exe")
APP = os.path.join(ROOT, "app.py")
ICON = os.path.join(ROOT, "ui", "icons", "app.ico")

PS = (
    "$d=[Environment]::GetFolderPath('Desktop');"
    "$w=New-Object -ComObject WScript.Shell;"
    "$l=$w.CreateShortcut((Join-Path $d 'Subtitle Sidekick.lnk'));"
    f"$l.TargetPath='{PYW}';"
    f"$l.Arguments='\"{APP}\"';"
    f"$l.WorkingDirectory='{ROOT}';"
    f"$l.IconLocation='{ICON},0';"
    "$l.Save()"
)

try:
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS],
                   check=True)
    print("created desktop shortcut")
except Exception as e:  # noqa: BLE001
    print("shortcut skipped:", e)
