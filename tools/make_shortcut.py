"""make_shortcut.py — יוצר קיצור דרך "כתוביות עברית" בשולחן העבודה.

נקרא פעם אחת ע"י run.bat אחרי ההתקנה, כדי שלא צריך CMD יותר — רק האייקון.
"""

import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYW = os.path.join(ROOT, ".venv", "Scripts", "pythonw.exe")
APP = os.path.join(ROOT, "app.py")

PS = (
    "$d=[Environment]::GetFolderPath('Desktop');"
    "$w=New-Object -ComObject WScript.Shell;"
    "$l=$w.CreateShortcut((Join-Path $d 'כתוביות עברית.lnk'));"
    f"$l.TargetPath='{PYW}';"
    f"$l.Arguments='\"{APP}\"';"
    f"$l.WorkingDirectory='{ROOT}';"
    f"$l.IconLocation='{PYW},0';"
    "$l.Save()"
)

try:
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS],
                   check=True)
    print("created desktop shortcut")
except Exception as e:  # noqa: BLE001
    print("shortcut skipped:", e)
