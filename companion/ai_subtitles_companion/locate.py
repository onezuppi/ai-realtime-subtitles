"""Find the llama-server program."""
from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

from .config import Config
from .errors import SetupError

LM_STUDIO_BACKENDS = Path.home() / ".lmstudio" / "extensions" / "backends"
# LM Studio keeps llama.cpp builds per platform. Prefer GPU builds: the plain AVX2 build runs on the CPU only.
LM_STUDIO_PATTERNS = {
    "win32": ["llama.cpp-win-x86_64-vulkan-avx2-*"],
    "darwin": ["llama.cpp-mac-arm64-apple-metal-advsimd-*"],
}
LM_STUDIO_PATTERNS_DEFAULT = ["llama.cpp-linux-x86_64-vulkan-avx2-*", "llama.cpp-linux-x86_64-avx2-*"]


def find_llama_server(config: Config) -> Path:
    for candidate in (config.llama_server, os.environ.get("LLAMA_SERVER", "")):
        if candidate:
            path = Path(candidate)
            if not path.exists():
                raise SetupError(f"llama-server not found: {path}")
            return path
    on_path = shutil.which("llama-server")
    if on_path:  # for example `brew install llama.cpp` on macOS
        return Path(on_path)
    exe = "llama-server.exe" if sys.platform == "win32" else "llama-server"
    for pattern in LM_STUDIO_PATTERNS.get(sys.platform, LM_STUDIO_PATTERNS_DEFAULT):
        found = []
        for folder in LM_STUDIO_BACKENDS.glob(pattern):
            match = re.search(r"-(\d+)\.(\d+)\.(\d+)$", folder.name)
            if match and (folder / exe).exists():
                found.append((tuple(int(part) for part in match.groups()), folder / exe))
        if found:
            return max(found)[1]
    raise SetupError("llama-server not found. Set llama_server in config.json, set LLAMA_SERVER, or add it to PATH.")
