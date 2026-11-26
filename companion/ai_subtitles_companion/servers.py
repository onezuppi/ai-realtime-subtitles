"""Start, check and stop the llama.cpp servers."""
from __future__ import annotations

import contextlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from . import localhttp
from .config import Config, app_dir, ensure_app_dir
from .errors import SetupError
from .locate import find_llama_server

CONTEXT_SIZE = 4096  # llama-server -c
GPU_LAYERS = 99  # llama-server -ngl: offload every layer to the GPU
POLL_INTERVAL = 0.5
LOG_TAIL_LINES = 20
LOG_NAME = "servers.log"
LEGACY_PID_NAME = "servers.pid"  # one file for all servers, written by older versions
NAMES = ("asr", "translate")
ALIASES = {"asr": "qwen3-asr", "translate": "plamo-3-translate"}  # llama-server --alias: how a server names its model
LOCK_NAME = "servers.lock"


def model_files(config: Config, names: tuple[str, ...] = NAMES) -> list[Path]:
    root = config.models_path
    files = []
    if "asr" in names:
        files += [root / config.asr_model, root / config.asr_mmproj]
    if "translate" in names:
        files.append(root / config.mt_model)
    missing = [str(f) for f in files if not f.exists()]
    if missing:
        raise SetupError("Model files not found: " + ", ".join(missing))
    return files


def build_commands(config: Config, exe: Path) -> dict[str, list[str]]:
    root = config.models_path
    common = ["--host", "127.0.0.1", "-c", str(CONTEXT_SIZE), "-ngl", str(GPU_LAYERS), *(config.extra_args or [])]
    return {
        "asr": [str(exe), "-m", str(root / config.asr_model), "--mmproj", str(root / config.asr_mmproj),
                "--port", str(config.asr_port), "--alias", ALIASES["asr"], *common],
        "translate": [str(exe), "-m", str(root / config.mt_model), "--port", str(config.mt_port),
                      "--alias", ALIASES["translate"], "--jinja", "--no-prefill-assistant", *common],
    }


def is_ready(port: int, timeout: float = 1.5, alias: str | None = None) -> bool:
    """True when /health answers 200 and, if `alias` is given, the server serves the model with that name.

    The alias check keeps another local program that happens to use the port from being taken for our server.
    """
    try:
        with localhttp.opener.open(f"http://127.0.0.1:{port}/health", timeout=timeout) as response:
            if response.status != 200:
                return False
        if alias is None:
            return True
        with localhttp.opener.open(f"http://127.0.0.1:{port}/v1/models", timeout=timeout) as response:
            models = json.loads(response.read().decode("utf-8")).get("data", [])
            return any(isinstance(model, dict) and model.get("id") == alias for model in models)
    except (OSError, ValueError, AttributeError):
        return False


def server_ready(config: Config, name: str) -> bool:
    port = config.asr_port if name == "asr" else config.mt_port
    return is_ready(port, alias=ALIASES[name])


def pid_file(name: str, folder: Path | None = None) -> Path:
    """One PID file per server, so starting one server never forgets the PID of the other."""
    return (folder or app_dir()) / f"servers.{name}.pid"


def _log_tail(path: Path) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join(lines[-LOG_TAIL_LINES:])


def _is_llama_server(pid: str) -> bool:
    """True when the process with this PID is a llama-server. A PID file outlives a crash or a reboot, and the
    system may give the number to an unrelated program: that program must never be stopped."""
    try:
        if sys.platform == "win32":
            command = ["tasklist", "/FI", f"PID eq {int(pid)}", "/FO", "CSV", "/NH"]
        else:
            command = ["ps", "-p", str(int(pid)), "-o", "comm="]
        output = subprocess.run(command, capture_output=True, text=True, timeout=10).stdout
    except (OSError, ValueError, subprocess.SubprocessError):
        return False
    return "llama-server" in output.lower()


def _recorded_pids(name: str, folder: Path) -> list[str]:
    try:
        return pid_file(name, folder).read_text(encoding="utf-8").split()
    except OSError:
        return []


def _already_launched(name: str, folder: Path) -> bool:
    """A server of ours that was started but does not answer yet (it is loading the model)."""
    return any(_is_llama_server(pid) for pid in _recorded_pids(name, folder))


@contextlib.contextmanager
def _start_lock(folder: Path):
    """One launcher at a time across processes: the CLI and the bridge can both decide to start the same server."""
    with open(folder / LOCK_NAME, "a+b") as handle:
        deadline = time.monotonic() + 60
        while True:
            try:
                if sys.platform == "win32":
                    import msvcrt
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise SetupError(f"another start is still running (lock file {folder / LOCK_NAME})") from None
                time.sleep(0.2)
        try:
            yield
        finally:
            if sys.platform == "win32":
                import msvcrt
                handle.seek(0)
                with contextlib.suppress(OSError):
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


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


def start(config: Config, wait_seconds: float = 90, names: tuple[str, ...] = NAMES) -> dict[str, bool]:
    """Start the named servers that are not running yet and wait until they answer /health.

    Plain subtitles need only "asr": the translation model is neither required on disk nor loaded.
    Raises SetupError as soon as a started server exits, with the end of servers.log in the message.
    """
    names = tuple(name for name in NAMES if name in names)
    processes: dict[str, subprocess.Popen] = {}
    folder = ensure_app_dir()
    with _start_lock(folder):
        # Decided under the lock: a second launcher sees the first one's server as already started.
        pending = [name for name in names if not server_ready(config, name) and not _already_launched(name, folder)]
        if pending:
            model_files(config, tuple(pending))
            commands = build_commands(config, find_llama_server(config))
            processes = _launch(pending, commands, folder)
    deadline = time.monotonic() + wait_seconds
    while True:
        state = {name: server_ready(config, name) for name in names}
        if all(state.values()) or time.monotonic() >= deadline:
            return state
        for name, process in processes.items():
            code = process.poll()
            if code is not None:
                tail = _log_tail(folder / LOG_NAME)
                _abort(processes, folder)
                raise SetupError(f"{name} server exited with code {code}. End of {folder / LOG_NAME}:\n{tail}")
        time.sleep(POLL_INTERVAL)


def _abort(processes: dict[str, subprocess.Popen], folder: Path) -> None:
    """After a failed start: stop the servers this attempt started and drop only its own PID records."""
    for name, process in processes.items():
        if process.poll() is None:
            _kill(str(process.pid))
        if _recorded_pids(name, folder) == [str(process.pid)]:
            pid_file(name, folder).unlink(missing_ok=True)


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
            if _is_llama_server(pid):
                stopped += _kill(pid)
        path.unlink(missing_ok=True)
    return stopped
