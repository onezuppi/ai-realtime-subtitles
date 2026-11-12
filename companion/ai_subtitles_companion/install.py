"""Register the native messaging host for Chrome, Brave and Edge (current user, no admin rights)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from . import HOST_NAME
from .config import app_dir

# Registry key of each browser's native messaging hosts (HKCU).
BROWSERS = {
    "chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
}


def detect_browsers() -> list[str]:
    """Browsers that look installed: their per-user or machine-wide registry key exists."""
    import winreg

    found = []
    for name, native_key in BROWSERS.items():
        vendor_key = native_key.rsplit("\\NativeMessagingHosts", 1)[0]
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                winreg.CloseKey(winreg.OpenKey(hive, vendor_key))
                found.append(name)
                break
            except OSError:
                continue
    return found


def registered_browsers() -> list[str]:
    import winreg

    result = []
    for name, path in BROWSERS.items():
        try:
            winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"{path}\{HOST_NAME}"))
            result.append(name)
        except OSError:
            continue
    return result


def write_launcher() -> Path:
    """A .bat file: the browser starts hosts as executables, not as `python -m`."""
    launcher = app_dir() / "host.bat"
    package_root = Path(__file__).resolve().parent.parent
    launcher.write_text(
        f'@echo off\r\ncd /d "{package_root}"\r\n"{sys.executable}" -m ai_subtitles_companion bridge\r\n',
        encoding="utf-8",
    )
    return launcher


def manifest(launcher: Path, extension_ids: list[str]) -> dict:
    return {
        "name": HOST_NAME,
        "description": "AI Realtime Subtitles companion",
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/" for extension_id in extension_ids],
    }


def install(extension_ids: list[str], browsers: list[str]) -> list[str]:
    import winreg  # Windows only

    launcher = write_launcher()
    manifest_path = app_dir() / f"{HOST_NAME}.json"
    manifest_path.write_text(json.dumps(manifest(launcher, extension_ids), indent=2), encoding="utf-8")
    done = []
    for name in browsers:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"{BROWSERS[name]}\{HOST_NAME}") as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
        done.append(name)
    return done


def uninstall() -> list[str]:
    import winreg

    removed = []
    for name, path in BROWSERS.items():
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"{path}\{HOST_NAME}")
            removed.append(name)
        except FileNotFoundError:
            pass
    return removed
