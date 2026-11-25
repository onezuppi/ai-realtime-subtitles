"""A small script that starts the bridge: browsers run the host as an executable, not as `python -m`."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

from ..errors import SetupError

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


def frozen_bat_text(program: str) -> str:
    return f'@echo off\r\n"{_bat_quoted(program)}" bridge\r\n'


def frozen_sh_text(program: str) -> str:
    return f'#!/bin/sh\nexec "{_sh_quoted(program)}" bridge\n'


def _keep_program(folder: Path) -> str:
    """Copy the packaged program into the data folder, so that moving or deleting the download does not break the bridge."""
    source = Path(sys.executable)
    target = folder / source.name
    if source.resolve() != target.resolve():
        try:
            shutil.copy2(source, target)
        except PermissionError as error:
            raise SetupError(f"cannot replace {target}: the browser is using it. Close the browser and run this again.") from error
    return str(target)


def write(windows: bool, folder: Path) -> Path:
    """Write host.bat (Windows) or host.sh (macOS, Linux) into the folder and return its path.

    In a packaged build (PyInstaller) sys.executable is the program itself: it has no package folder to change
    into and takes the command directly.
    """
    frozen = getattr(sys, "frozen", False)
    launcher = folder / ("host.bat" if windows else "host.sh")
    if frozen:
        program = _keep_program(folder)
        text = frozen_bat_text(program) if windows else frozen_sh_text(program)
    else:
        text = bat_text(PACKAGE_ROOT, sys.executable) if windows else sh_text(PACKAGE_ROOT, sys.executable)
    # Bytes, not write_text: on Windows write_text would double the carriage return of a .bat file.
    launcher.write_bytes(text.encode("utf-8"))
    if not windows:
        launcher.chmod(0o755)
    return launcher
