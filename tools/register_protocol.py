"""register_protocol.py — registers the custom subsidekick:// protocol on Windows.

After registration (one-time), a link/bookmark to subsidekick://open in Chrome (or any browser)
opens Subtitle Sidekick — no extension, no native messaging needed.
Called by run.bat on first install, alongside desktop shortcut creation.
"""

import os
import sys
import winreg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYW = os.path.join(ROOT, ".venv", "Scripts", "pythonw.exe")
APP = os.path.join(ROOT, "app.py")
SCHEME = "subsidekick"


def register():
    command = f'"{PYW}" "{APP}"'
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, f"Software\\Classes\\{SCHEME}") as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, f"URL:{SCHEME} Protocol")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER,
                           f"Software\\Classes\\{SCHEME}\\shell\\open\\command") as key:
        winreg.SetValueEx(key, None, 0, winreg.REG_SZ, command)


if __name__ == "__main__":
    try:
        register()
        print(f"registered {SCHEME}:// protocol -> {APP}")
    except Exception as e:  # noqa: BLE001
        print("protocol registration skipped:", e)
        sys.exit(0)  # non-critical — don't abort install over this
