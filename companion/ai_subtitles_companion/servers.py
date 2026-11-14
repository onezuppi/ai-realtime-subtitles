"""Start, check and stop the llama.cpp servers."""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from .config import Config, app_dir, ensure_app_dir
from .errors import SetupError
from .locate import find_llama_server

CONTEXT_SIZE = 4096  # llama-server -c
GPU_LAYERS = 99  # llama-server -ngl: offload every layer to the GPU
POLL_INTERVAL = 0.5
LOG_TAIL_LINES = 20
LOG_NAME = "servers.log"
LEGACY_PID_NAME = "servers.pid"  # one file for all servers, written by older versions


def model_files(config: Config) -> list[Path]:
    root = config.models_path
    files = [root / config.asr_model, root / config.asr_mmproj, root / config.mt_model]
    missing = [str(f) for f in files if not f.exists()]
    if missing:
        raise SetupError("Model files not found: " + ", ".join(missing))
    return files


def build_commands(config: Config, exe: Path) -> dict[str, list[str]]:
    root = config.models_path
    common = ["--host", "127.0.0.1", "-c", str(CONTEXT_SIZE), "-ngl", str(GPU_LAYERS), *(config.extra_args or [])]
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


def pid_file(name: str, folder: Path | None = None) -> Path:
    """One PID file per server, so starting one server never forgets the PID of the other."""
    return (folder or app_dir()) / f"servers.{name}.pid"


def _log_tail(path: Path) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join(lines[-LOG_TAIL_LINES:])


def _launch(names: list[str], commands: dict[str, list[str]], folder: Path) -> dict[str, subprocess.Popen]:
    # Detach the servers from this process so they survive when the browser closes the bridge.
    detach = (
        {"creationflags": subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP}
        if sys.platform == "win32"
        else {"start_new_session": True}
    )
    processes = {}
    with open(folder / LOG_NAME, "ab") as log:  # the children keep their own handles
        for name in names:
            process = subprocess.Popen(commands[name], stdout=log, stderr=log, stdin=subprocess.DEVNULL, **detach)
            pid_file(name, folder).write_text(str(process.pid), encoding="utf-8")
            processes[name] = process
    return processes


def start(config: Config, wait_seconds: float = 90) -> dict[str, bool]:
    """Start the servers that are not running yet and wait until both answer /health.

    Raises SetupError as soon as a started server exits, with the end of servers.log in the message.
    """
    ports = {"asr": config.asr_port, "translate": config.mt_port}
    pending = [name for name, port in ports.items() if not is_ready(port)]
    processes: dict[str, subprocess.Popen] = {}
    folder = app_dir()
    if pending:
        model_files(config)
        commands = build_commands(config, find_llama_server(config))
        folder = ensure_app_dir()
        processes = _launch(pending, commands, folder)
    deadline = time.monotonic() + wait_seconds
    while True:
        state = {name: is_ready(port) for name, port in ports.items()}
        if all(state.values()) or time.monotonic() >= deadline:
            return state
        for name, process in processes.items():
            code = process.poll()
            if code is not None:
                pid_file(name, folder).unlink(missing_ok=True)
                tail = _log_tail(folder / LOG_NAME)
                raise SetupError(f"{name} server exited with code {code}. End of {folder / LOG_NAME}:\n{tail}")
        time.sleep(POLL_INTERVAL)


def _kill(pid: str) -> bool:
    if sys.platform == "win32":
        return subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True).returncode == 0
    try:
        os.killpg(int(pid), signal.SIGTERM)  # each server leads its own session and process group
        return True
    except (OSError, ValueError):
        return False


def stop() -> int:
    """Stop the servers this program started. Returns how many processes were stopped."""
    folder = app_dir()
    paths = [pid_file(name, folder) for name in ("asr", "translate")] + [folder / LEGACY_PID_NAME]
    stopped = 0
    for path in paths:
        if not path.exists():
            continue
        for pid in path.read_text(encoding="utf-8").split():
            stopped += _kill(pid)
        path.unlink(missing_ok=True)
    return stopped
