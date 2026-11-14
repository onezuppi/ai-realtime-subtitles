"""macOS and Linux: the manifest file goes into the browser's NativeMessagingHosts folder in the home directory."""
from __future__ import annotations

import shutil
from pathlib import Path

from .manifest import MANIFEST_FILE

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


def host_manifest_dir(browser: str, system: str, home: Path | None = None) -> Path:
    """Folder that holds the host manifest. `system` is "linux" or "darwin"."""
    return (home or Path.home()) / POSIX_FOLDERS[system][browser] / "NativeMessagingHosts"


def detect(system: str, home: Path | None = None) -> list[str]:
    found = []
    for name in POSIX_FOLDERS[system]:
        data_folder = host_manifest_dir(name, system, home).parent
        if data_folder.exists() or any(shutil.which(command) for command in EXECUTABLES[name]):
            found.append(name)
    return found


def registered(system: str, home: Path | None = None) -> list[str]:
    return [name for name in POSIX_FOLDERS[system] if (host_manifest_dir(name, system, home) / MANIFEST_FILE).exists()]


def install(content: str, browsers: list[str], system: str, home: Path | None = None) -> list[str]:
    done = []
    for name in browsers:
        folder = host_manifest_dir(name, system, home)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / MANIFEST_FILE).write_text(content, encoding="utf-8")
        done.append(name)
    return done


def uninstall(system: str, home: Path | None = None) -> list[str]:
    removed = []
    for name in POSIX_FOLDERS[system]:
        path = host_manifest_dir(name, system, home) / MANIFEST_FILE
        if path.exists():
            path.unlink()
            removed.append(name)
    return removed
