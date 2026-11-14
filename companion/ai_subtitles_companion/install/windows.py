"""Windows: one registry key per browser under HKEY_CURRENT_USER that points to the manifest file."""
from __future__ import annotations

from pathlib import Path

from .. import HOST_NAME
from .manifest import MANIFEST_FILE

WINDOWS_KEYS = {
    "chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "chromium": r"Software\Chromium\NativeMessagingHosts",
    "brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
}


def _host_key(browser: str) -> str:
    return rf"{WINDOWS_KEYS[browser]}\{HOST_NAME}"


def detect() -> list[str]:
    """Browsers whose vendor key exists for this user or for the machine."""
    import winreg

    found = []
    for name, native_key in WINDOWS_KEYS.items():
        vendor_key = native_key.rsplit("\\NativeMessagingHosts", 1)[0]
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                winreg.CloseKey(winreg.OpenKey(hive, vendor_key))
                found.append(name)
                break
            except OSError:
                continue
    return found


def registered() -> list[str]:
    import winreg

    result = []
    for name in WINDOWS_KEYS:
        try:
            winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CURRENT_USER, _host_key(name)))
            result.append(name)
        except OSError:
            continue
    return result


def install(content: str, browsers: list[str], folder: Path) -> list[str]:
    """Write the manifest into the folder and point each browser's registry key at it."""
    import winreg

    manifest_path = folder / MANIFEST_FILE
    manifest_path.write_text(content, encoding="utf-8")
    done = []
    for name in browsers:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _host_key(name)) as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
        done.append(name)
    return done


def uninstall() -> list[str]:
    import winreg

    removed = []
    for name in WINDOWS_KEYS:
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, _host_key(name))
            removed.append(name)
        except FileNotFoundError:
            pass
    return removed
