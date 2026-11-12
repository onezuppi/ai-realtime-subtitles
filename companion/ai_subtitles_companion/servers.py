"""Start, check and stop the llama.cpp servers."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from .config import Config, app_dir

LM_STUDIO_BACKENDS = Path.home() / ".lmstudio" / "extensions" / "backends"


class SetupError(RuntimeError):
    """Something the user must fix: a missing file or program."""


def find_llama_server(config: Config) -> Path:
    for candidate in (config.llama_server, os.environ.get("LLAMA_SERVER", "")):
        if candidate:
            path = Path(candidate)
            if not path.exists():
                raise SetupError(f"llama-server not found: {path}")
            return path
    on_path = shutil.which("llama-server")
    if on_path:
        return Path(on_path)
    # Prefer the Vulkan build: the plain AVX2 build runs on the CPU only.
    found = []
    for folder in LM_STUDIO_BACKENDS.glob("llama.cpp-win-x86_64-vulkan-avx2-*"):
        match = re.search(r"-(\d+)\.(\d+)\.(\d+)$", folder.name)
        if match and (folder / "llama-server.exe").exists():
            found.append((tuple(int(part) for part in match.groups()), folder / "llama-server.exe"))
    if not found:
        raise SetupError("llama-server not found. Set llama_server in config.json or add it to PATH.")
    return max(found)[1]


def model_files(config: Config) -> list[Path]:
    root = config.models_path
    files = [root / config.asr_model, root / config.asr_mmproj, root / config.mt_model]
    missing = [str(f) for f in files if not f.exists()]
    if missing:
        raise SetupError("Model files not found: " + ", ".join(missing))
    return files


def build_commands(config: Config, exe: Path) -> dict[str, list[str]]:
    root = config.models_path
    common = ["--host", "127.0.0.1", "-c", "4096", "-ngl", "99", *(config.extra_args or [])]
    return {
        "asr": [str(exe), "-m", str(root / config.asr_model), "--mmproj", str(root / config.asr_mmproj),
                "--port", str(config.asr_port), "--alias", "qwen3-asr", *common],
        "translate": [str(exe), "-m", str(root / config.mt_model), "--port", str(config.mt_port),
                      "--alias", "plamo-3-translate", "--jinja", "--no-prefill-assistant", *common],
    }


def is_ready(port: int, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=timeout) as response:
            return response.status == 200
    except OSError:
        return False


def _pid_file() -> Path:
    return app_dir() / "servers.pid"


def start(config: Config, wait_seconds: float = 90) -> dict[str, bool]:
    """Start the servers that are not running yet and wait until both answer /health."""
    ports = {"asr": config.asr_port, "translate": config.mt_port}
    pending = [name for name, port in ports.items() if not is_ready(port)]
    if pending:
        model_files(config)
        commands = build_commands(config, find_llama_server(config))
        log = open(app_dir() / "servers.log", "ab")
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        pids = []
        for name in pending:
            process = subprocess.Popen(commands[name], stdout=log, stderr=log, stdin=subprocess.DEVNULL, creationflags=flags)
            pids.append(process.pid)
        _pid_file().write_text("\n".join(map(str, pids)), encoding="utf-8")
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        state = {name: is_ready(port) for name, port in ports.items()}
        if all(state.values()):
            return state
        time.sleep(0.5)
    return {name: is_ready(port) for name, port in ports.items()}


def stop() -> int:
    """Stop the servers this program started. Returns how many processes were stopped."""
    path = _pid_file()
    if not path.exists():
        return 0
    stopped = 0
    for line in path.read_text(encoding="utf-8").split():
        if os.name == "nt":
            result = subprocess.run(["taskkill", "/PID", line, "/T", "/F"], capture_output=True)
            stopped += result.returncode == 0
        else:
            try:
                os.kill(int(line), 15)
                stopped += 1
            except OSError:
                pass
    path.unlink(missing_ok=True)
    return stopped
