"""Windows: one registry key per browser under HKEY_CURRENT_USER that points to the manifest file."""
from __future__ import annotations

import json
from pathlib import Path

from .. import HOST_NAME

WINDOWS_KEYS = {
    "chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "chromium": r"Software\Chromium\NativeMessagingHosts",
    "brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
}

# Brave on Windows reads the Chrome key and ignores its own: a host registered only under
# BraveSoftware\Brave-Browser ends in "Specified native messaging host not found".
ALSO_READS = {"brave": "chrome"}


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


def _manifest_file(folder: Path, target: str) -> Path:
    return folder / f"{HOST_NAME}.{target}.json"


def _merged(content: str, existing: Path) -> str:
    """Add the origins of an earlier manifest at this key to the new ones: two installs for different
    extension IDs (a store build and an unpacked build) must not lock each other out."""
    try:
        old = json.loads(existing.read_text(encoding="utf-8")).get("allowed_origins", [])
        new = json.loads(content)
    except (OSError, ValueError, AttributeError):
        return content
    if not isinstance(old, list) or not isinstance(new, dict):
        return content
    new["allowed_origins"] = list(dict.fromkeys([*new.get("allowed_origins", []), *[o for o in old if isinstance(o, str)]]))
    return json.dumps(new, indent=2)


def install(content: str, browsers: list[str], folder: Path) -> list[str]:
    """Write one manifest per registry key into the folder and point each key at its own manifest."""
    import winreg

    done = []
    for name in browsers:
        for target in dict.fromkeys([name, ALSO_READS.get(name, name)]):
            manifest_path = _manifest_file(folder, target)
            manifest_path.write_text(_merged(content, manifest_path), encoding="utf-8")
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _host_key(target)) as key:
                winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
        done.append(name)
    return done


def uninstall(folder: Path | None = None) -> list[str]:
    import winreg

    removed = []
    for name in WINDOWS_KEYS:
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, _host_key(name))
            removed.append(name)
        except FileNotFoundError:
            pass
        if folder is not None:
            _manifest_file(folder, name).unlink(missing_ok=True)
    return removed
