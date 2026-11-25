"""Settings stored in %LOCALAPPDATA%\\ai-realtime-subtitles\\config.json (or ~/.config on other systems)."""
from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from .errors import SetupError


def app_dir() -> Path:
    """Per-user data folder: %LOCALAPPDATA% on Windows, ~/Library/Application Support on macOS, ~/.config on Linux.

    Only computes the path. Code that writes into the folder calls ensure_app_dir() instead.
    """
    if os.environ.get("LOCALAPPDATA"):
        base = Path(os.environ["LOCALAPPDATA"])
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "ai-realtime-subtitles"


def ensure_app_dir() -> Path:
    """The data folder, created if it does not exist yet."""
    path = app_dir()
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Config:
    models_dir: str = ""
    asr_model: str = "Qwen3-ASR-0.6B-Q8_0.gguf"
    asr_mmproj: str = "mmproj-Qwen3-ASR-0.6B-Q8_0.gguf"
    mt_model: str = "plamo-3-translate-2b-Q4_K_M.gguf"
    asr_port: int = 8083
    mt_port: int = 8082
    # Path to llama-server. Empty means: LLAMA_SERVER variable, PATH, then the newest LM Studio backend.
    llama_server: str = ""
    # Start the model servers when the extension connects through the bridge.
    autostart: bool = True
    # Extra arguments, for example ["-ngl", "0"] to run on the CPU.
    extra_args: list[str] | None = None

    @property
    def models_path(self) -> Path:
        return Path(self.models_dir) if self.models_dir else app_dir() / "models"


def config_path() -> Path:
    return app_dir() / "config.json"


def load() -> Config:
    """Read config.json. Raises SetupError if the file is not valid JSON or has values of the wrong shape."""
    path = config_path()
    if not path.exists():
        return Config()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise TypeError(f"expected a JSON object, got {type(raw).__name__}")
        known = {f.name for f in fields(Config)}
        config = Config(**{key: value for key, value in raw.items() if key in known})
        validate(config)
        return config
    except (ValueError, TypeError) as error:  # JSONDecodeError and UnicodeDecodeError are ValueErrors
        raise SetupError(f"config.json is invalid: {error} ({path})") from error


def validate(config: Config) -> None:
    """Raise ValueError for a value of the wrong type or range. The dataclass annotations are not checked at runtime."""
    for name in ("models_dir", "asr_model", "asr_mmproj", "mt_model", "llama_server"):
        if not isinstance(getattr(config, name), str):
            raise ValueError(f"{name} must be a string")
    for name in ("asr_port", "mt_port"):
        port = getattr(config, name)
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError(f"{name} must be a port number from 1 to 65535")
    if config.asr_port == config.mt_port:
        raise ValueError("asr_port and mt_port must differ")
    if not isinstance(config.autostart, bool):
        raise ValueError("autostart must be true or false")
    if config.extra_args is not None and not (
            isinstance(config.extra_args, list) and all(isinstance(arg, str) for arg in config.extra_args)):
        raise ValueError("extra_args must be a list of strings")


def save(config: Config) -> None:
    ensure_app_dir()
    config_path().write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
