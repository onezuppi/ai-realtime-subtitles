"""Register the native messaging host for Chrome, Chromium, Brave and Edge on Windows, macOS and Linux.

Windows: one registry key per browser under HKEY_CURRENT_USER that points to the manifest file.
macOS and Linux: the manifest file itself goes into the browser's NativeMessagingHosts folder in the
user's home directory. No administrator rights are needed on any system.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from . import HOST_NAME
from .config import app_dir

WINDOWS_KEYS = {
    "chrome": r"Software\Google\Chrome\NativeMessagingHosts",
    "chromium": r"Software\Chromium\NativeMessagingHosts",
    "brave": r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
    "edge": r"Software\Microsoft\Edge\NativeMessagingHosts",
}

# Browser data folder relative to the home directory. The host manifest goes into <folder>/NativeMessagingHosts.
POSIX_FOLDERS = {
    "linux": {
        "chrome": ".config/google-chrome",
        "chromium": ".config/chromium",
        "brave": ".config/BraveSoftware/Brave-Browser",
        "edge": ".config/microsoft-edge",
    },
    "darwin": {
        "chrome": "Library/Application Support/Google/Chrome",
        "chromium": "Library/Application Support/Chromium",
        "brave": "Library/Application Support/BraveSoftware/Brave-Browser",
        "edge": "Library/Application Support/Microsoft Edge",
    },
}

# Command names that show a browser is installed even if its data folder does not exist yet.
EXECUTABLES = {
    "chrome": ["google-chrome", "google-chrome-stable", "chrome"],
    "chromium": ["chromium", "chromium-browser"],
    "brave": ["brave-browser", "brave"],
    "edge": ["microsoft-edge", "microsoft-edge-stable"],
}


def platform_key(platform: str | None = None) -> str:
    platform = platform or sys.platform
    if platform.startswith("win"):
        return "windows"
    if platform == "darwin":
        return "darwin"
    return "linux"


def browser_names(platform: str | None = None) -> list[str]:
    return list(WINDOWS_KEYS if platform_key(platform) == "windows" else POSIX_FOLDERS[platform_key(platform)])


def host_manifest_dir(browser: str, platform: str | None = None, home: Path | None = None) -> Path:
    """Folder that holds the host manifest on macOS and Linux."""
    return (home or Path.home()) / POSIX_FOLDERS[platform_key(platform)][browser] / "NativeMessagingHosts"


def detect_browsers(platform: str | None = None, home: Path | None = None) -> list[str]:
    """Browsers that look installed."""
    system = platform_key(platform)
    found = []
    if system == "windows":
        import winreg

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
    for name in POSIX_FOLDERS[system]:
        data_folder = host_manifest_dir(name, platform, home).parent
        if data_folder.exists() or any(shutil.which(command) for command in EXECUTABLES[name]):
            found.append(name)
    return found


def registered_browsers(platform: str | None = None, home: Path | None = None) -> list[str]:
    system = platform_key(platform)
    result = []
    if system == "windows":
        import winreg

        for name, path in WINDOWS_KEYS.items():
            try:
                winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"{path}\{HOST_NAME}"))
                result.append(name)
            except OSError:
                continue
        return result
    for name in POSIX_FOLDERS[system]:
        if (host_manifest_dir(name, platform, home) / f"{HOST_NAME}.json").exists():
            result.append(name)
    return result


def write_launcher(platform: str | None = None, launch_dir: Path | None = None) -> Path:
    """A small script that starts the bridge: browsers run the host as an executable, not as `python -m`."""
    package_root = Path(__file__).resolve().parent.parent
    folder = launch_dir or app_dir()
    if platform_key(platform) == "windows":
        launcher = folder / "host.bat"
        launcher.write_text(
            f'@echo off\r\ncd /d "{package_root}"\r\n"{sys.executable}" -m ai_subtitles_companion bridge\r\n',
            encoding="utf-8",
        )
    else:
        launcher = folder / "host.sh"
        launcher.write_text(
            f'#!/bin/sh\ncd "{package_root}" || exit 1\nexec "{sys.executable}" -m ai_subtitles_companion bridge\n',
            encoding="utf-8",
        )
        launcher.chmod(0o755)
    return launcher


def manifest(launcher: Path, extension_ids: list[str]) -> dict:
    return {
        "name": HOST_NAME,
        "description": "AI Realtime Subtitles companion",
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/" for extension_id in extension_ids],
    }


def install(extension_ids: list[str], browsers: list[str], platform: str | None = None,
            home: Path | None = None, launch_dir: Path | None = None) -> list[str]:
    system = platform_key(platform)
    launcher = write_launcher(platform, launch_dir)
    content = json.dumps(manifest(launcher, extension_ids), indent=2)
    done = []
    if system == "windows":
        import winreg

        manifest_path = (launch_dir or app_dir()) / f"{HOST_NAME}.json"
        manifest_path.write_text(content, encoding="utf-8")
        for name in browsers:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"{WINDOWS_KEYS[name]}\{HOST_NAME}") as key:
                winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
            done.append(name)
        return done
    for name in browsers:
        folder = host_manifest_dir(name, platform, home)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{HOST_NAME}.json").write_text(content, encoding="utf-8")
        done.append(name)
    return done


def uninstall(platform: str | None = None, home: Path | None = None) -> list[str]:
    system = platform_key(platform)
    removed = []
    if system == "windows":
        import winreg

        for name, path in WINDOWS_KEYS.items():
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"{path}\{HOST_NAME}")
                removed.append(name)
            except FileNotFoundError:
                pass
        return removed
    for name in POSIX_FOLDERS[system]:
        path = host_manifest_dir(name, platform, home) / f"{HOST_NAME}.json"
        if path.exists():
            path.unlink()
            removed.append(name)
    return removed
