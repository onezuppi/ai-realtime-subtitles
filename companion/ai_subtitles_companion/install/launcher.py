"""A small script that starts the bridge: browsers run the host as an executable, not as `python -m`."""
from __future__ import annotations

import sys
from pathlib import Path

# The folder that contains the ai_subtitles_companion package (this file is ai_subtitles_companion/install/launcher.py).
# The launcher changes into it so that `python -m ai_subtitles_companion` finds the package.
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
MODULE_COMMAND = "-m ai_subtitles_companion bridge"


def _bat_quoted(value: Path | str) -> str:
    """Text for inside "..." in a .bat file. % starts a variable even in quotes, so it is doubled."""
    text = str(value)
    if '"' in text:
        raise ValueError(f'a path with a double quote cannot be used in host.bat: {text}')
    return text.replace("%", "%%")


def _sh_quoted(value: Path | str) -> str:
    """Text for inside "..." in a shell script: \\, ", $ and ` keep a special meaning there."""
    text = str(value)
    for char in ("\\", '"', "$", "`"):
        text = text.replace(char, "\\" + char)
    return text


def bat_text(package_root: Path, python: str) -> str:
    return (f'@echo off\r\ncd /d "{_bat_quoted(package_root)}"\r\n'
            f'"{_bat_quoted(python)}" {MODULE_COMMAND}\r\n')


def sh_text(package_root: Path, python: str) -> str:
    return f'#!/bin/sh\ncd "{_sh_quoted(package_root)}" || exit 1\nexec "{_sh_quoted(python)}" {MODULE_COMMAND}\n'


def write(windows: bool, folder: Path) -> Path:
    """Write host.bat (Windows) or host.sh (macOS, Linux) into the folder and return its path."""
    if windows:
        launcher = folder / "host.bat"
        launcher.write_text(bat_text(PACKAGE_ROOT, sys.executable), encoding="utf-8")
    else:
        launcher = folder / "host.sh"
        launcher.write_text(sh_text(PACKAGE_ROOT, sys.executable), encoding="utf-8")
        launcher.chmod(0o755)
    return launcher
