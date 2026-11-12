"""Settings stored in %LOCALAPPDATA%\\ai-realtime-subtitles\\config.json (or ~/.config on other systems)."""
from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path


def app_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".config")
    path = Path(base) / "ai-realtime-subtitles"
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
    path = config_path()
    if not path.exists():
        return Config()
    raw = json.loads(path.read_text(encoding="utf-8"))
    known = {f.name for f in fields(Config)}
    return Config(**{key: value for key, value in raw.items() if key in known})


def save(config: Config) -> None:
    config_path().write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
