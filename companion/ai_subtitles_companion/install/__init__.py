"""Register the native messaging host for Chrome, Chromium, Brave and Edge on Windows, macOS and Linux.

Windows: one registry key per browser under HKEY_CURRENT_USER that points to the manifest file.
macOS and Linux: the manifest file itself goes into the browser's NativeMessagingHosts folder in the
user's home directory. No administrator rights are needed on any system.

Every function takes an optional `platform` (a sys.platform value), `home` and `launch_dir`, so tests can
run the code paths of any system against temporary folders.
"""
from __future__ import annotations

import sys
from pathlib import Path

from ..config import ensure_app_dir
from . import launcher, posix, windows
from .manifest import manifest, manifest_text
from .posix import EXECUTABLES, POSIX_FOLDERS
from .windows import WINDOWS_KEYS

__all__ = [
    "EXECUTABLES", "POSIX_FOLDERS", "WINDOWS_KEYS", "browser_names", "detect_browsers", "host_manifest_dir",
    "install", "manifest", "platform_key", "registered_browsers", "uninstall", "write_launcher",
]


def platform_key(platform: str | None = None) -> str:
    platform = platform or sys.platform
    if platform.startswith("win"):
        return "windows"
    if platform == "darwin":
        return "darwin"
    return "linux"


def browser_names(platform: str | None = None) -> list[str]:
    system = platform_key(platform)
    return list(WINDOWS_KEYS if system == "windows" else POSIX_FOLDERS[system])


def host_manifest_dir(browser: str, platform: str | None = None, home: Path | None = None) -> Path:
    """Folder that holds the host manifest on macOS and Linux."""
    return posix.host_manifest_dir(browser, platform_key(platform), home)


def detect_browsers(platform: str | None = None, home: Path | None = None) -> list[str]:
    """Browsers that look installed."""
    system = platform_key(platform)
    return windows.detect() if system == "windows" else posix.detect(system, home)


def registered_browsers(platform: str | None = None, home: Path | None = None) -> list[str]:
    system = platform_key(platform)
    return windows.registered() if system == "windows" else posix.registered(system, home)


def write_launcher(platform: str | None = None, launch_dir: Path | None = None) -> Path:
    """A small script that starts the bridge: browsers run the host as an executable, not as `python -m`."""
    return launcher.write(platform_key(platform) == "windows", launch_dir or ensure_app_dir())


def install(extension_ids: list[str], browsers: list[str], platform: str | None = None,
            home: Path | None = None, launch_dir: Path | None = None) -> list[str]:
    system = platform_key(platform)
    folder = launch_dir or ensure_app_dir()
    content = manifest_text(write_launcher(platform, folder), extension_ids)
    if system == "windows":
        return windows.install(content, browsers, folder)
    return posix.install(content, browsers, system, home)


def uninstall(platform: str | None = None, home: Path | None = None) -> list[str]:
    system = platform_key(platform)
    return windows.uninstall(app_dir()) if system == "windows" else posix.uninstall(system, home)
