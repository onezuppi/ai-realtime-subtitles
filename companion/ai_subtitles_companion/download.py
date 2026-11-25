"""Download llama-server and the model files: the `download` command.

Every file is pinned by size and SHA-256, so a broken or replaced download is rejected. A partial download
resumes from the .part file.
"""
from __future__ import annotations

import hashlib
import platform
import shutil
import sys
import tarfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Config, app_dir
from .errors import SetupError

LLAMA_TAG = "b12728"
LLAMA_URL = f"https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}/llama-{LLAMA_TAG}-bin-"
ASR_URL = "https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/main/"
MT_URL = "https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF/resolve/main/"
CHUNK = 1 << 20
TIMEOUT = 60


@dataclass(frozen=True)
class Item:
    name: str
    url: str
    size: int
    sha256: str


# Vulkan builds run on any GPU. macOS builds use Metal. Keys are (platform_key, machine).
LLAMA_ARCHIVES = {
    ("windows", "x64"): Item("win-vulkan-x64.zip", LLAMA_URL + "win-vulkan-x64.zip", 39101990,
                             "d95e91824e3efc5a0de2746ba09a99700e9b81e741573e0b7ffbe404e500257d"),
    ("windows", "arm64"): Item("win-vulkan-arm64.zip", LLAMA_URL + "win-vulkan-arm64.zip", 26735751,
                               "e8deb834cbd0e0cdece4b5a11831acc0ba2e262c11f26d0aece125499bd6d8e9"),
    ("linux", "x64"): Item("ubuntu-vulkan-x64.tar.gz", LLAMA_URL + "ubuntu-vulkan-x64.tar.gz", 37107359,
                           "99b1a7a54829fa53964c5db6ab34c5f9a7734fb8029506e55bf3d04e24ba4979"),
    ("linux", "arm64"): Item("ubuntu-vulkan-arm64.tar.gz", LLAMA_URL + "ubuntu-vulkan-arm64.tar.gz", 30078554,
                             "49661bc1b434d77385e7cffa5741c874155276c4de2b2463c3033938d7a7f859"),
    ("darwin", "arm64"): Item("macos-arm64.tar.gz", LLAMA_URL + "macos-arm64.tar.gz", 16834886,
                              "001140842db7fa5253e57f891c14db5377937faf07d955a2646b471df0e7d9bd"),
    ("darwin", "x64"): Item("macos-x64.tar.gz", LLAMA_URL + "macos-x64.tar.gz", 12557446,
                            "817b0faa91432ff32ccd6895a7b11a19f0d6ee57d3800c75e93c7d78265c1a9d"),
}

MODELS = {
    "asr": [
        Item("Qwen3-ASR-0.6B-Q8_0.gguf", ASR_URL + "Qwen3-ASR-0.6B-Q8_0.gguf", 804749536,
             "05c9e10cecb37f6fc0cac0e786195dba82f12c15021f0b8a09473dbf3b6f090d"),
        Item("mmproj-Qwen3-ASR-0.6B-Q8_0.gguf", ASR_URL + "mmproj-Qwen3-ASR-0.6B-Q8_0.gguf", 214392544,
             "3b5e371a03e7d14bc1b5a66f38ff3c5eec3a99b3f96deb72b3814da9adafb16d"),
    ],
    "translate": [
        Item("plamo-3-translate-2b-Q4_K_M.gguf", MT_URL + "plamo-3-translate-2b-Q4_K_M.gguf", 1807203040,
             "1ffd9073afcc70e35ccc942428aa2b73d7aa2b9ea779bf504b775369e0276c13"),
    ],
}
PARTS = ["server", *MODELS]


def llama_dir() -> Path:
    return app_dir() / "llama.cpp" / LLAMA_TAG


def machine_key() -> str:
    machine = platform.machine().lower()
    return "arm64" if machine in ("arm64", "aarch64") else "x64"


def _system() -> str:
    return "windows" if sys.platform == "win32" else "darwin" if sys.platform == "darwin" else "linux"


def downloaded_llama_server() -> Path | None:
    """llama-server from a previous `download`, or None."""
    exe = "llama-server.exe" if sys.platform == "win32" else "llama-server"
    found = sorted(llama_dir().rglob(exe)) if llama_dir().exists() else []
    return found[0] if found else None


def missing_models(config: Config) -> list[str]:
    root = config.models_path
    return [item.name for items in MODELS.values() for item in items if not (root / item.name).exists()]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        while chunk := file.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _show(name: str, done: int, total: int, last: list[int]) -> None:
    percent = done * 100 // total
    if sys.stdout.isatty():
        print(f"\r  {name}: {done / 1e6:.0f} of {total / 1e6:.0f} MB ({percent}%)", end="", flush=True)
    elif percent // 10 != last[0] // 10 or last[0] < 0:
        print(f"  {name}: {percent}%", flush=True)
    last[0] = percent


def fetch(item: Item, target: Path, progress: Callable[[str, int, int, list[int]], None] = _show) -> None:
    """Download item to target. Resumes target.part, checks size and SHA-256, then renames."""
    target.parent.mkdir(parents=True, exist_ok=True)
    part = target.with_name(target.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if have > item.size:
        part.unlink()
        have = 0
    if have < item.size:  # a complete .part (the run stopped before the rename) needs no request: a Range past the end gets 416
        request = urllib.request.Request(item.url, headers={"User-Agent": "ai-realtime-subtitles"})
        if have:
            request.add_header("Range", f"bytes={have}-")
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                if have and response.status != 206:  # the server ignored Range: start again
                    have = 0
                last = [-1]
                with open(part, "ab" if have else "wb") as file:
                    while chunk := response.read(CHUNK):
                        file.write(chunk)
                        have += len(chunk)
                        progress(item.name, have, item.size, last)
        except OSError as error:
            raise SetupError(f"download of {item.name} failed: {error}. Run the command again to resume.") from error
        if sys.stdout.isatty():
            print()
    if part.stat().st_size != item.size or _sha256(part) != item.sha256:
        part.unlink()
        raise SetupError(f"{item.name} is damaged or was replaced: size or SHA-256 differs. Run the command again.")
    part.replace(target)


def _safe(base: Path, name: str) -> Path:
    path = (base / name).resolve()
    if base.resolve() not in path.parents and path != base.resolve():
        raise SetupError(f"archive entry leaves the target folder: {name}")
    return path


def extract(archive: Path, target: Path) -> None:
    """Unpack a .zip or .tar.gz into target. Entries that point outside it are refused."""
    target.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zipped:
            for name in zipped.namelist():
                _safe(target, name)
            zipped.extractall(target)
        return
    with tarfile.open(archive) as tarred:
        for member in tarred.getmembers():
            _safe(target, member.name)
            if member.issym() or member.islnk():
                link = member.linkname if member.islnk() else str(Path(member.name).parent / member.linkname)
                _safe(target, link)
        tarred.extractall(target)


def download_server() -> Path:
    item = LLAMA_ARCHIVES.get((_system(), machine_key()))
    if item is None:
        raise SetupError(f"no llama.cpp build for {_system()} {platform.machine()}. Install llama-server yourself and "
                         "set llama_server in config.json.")
    existing = downloaded_llama_server()
    if existing:
        print(f"llama-server {LLAMA_TAG}: already there ({existing})")
        return existing
    print(f"llama-server {LLAMA_TAG} ({item.name}, {item.size / 1e6:.0f} MB)")
    archive = llama_dir().parent / item.name
    fetch(item, archive)
    # Unpack beside the final folder and rename when complete: a run that stops half way (full disk) leaves no
    # llama-server that a later run would take for a finished install.
    staging = llama_dir().with_name(llama_dir().name + ".tmp")
    shutil.rmtree(staging, ignore_errors=True)
    try:
        extract(archive, staging)
        exe = "llama-server.exe" if sys.platform == "win32" else "llama-server"
        if not any(staging.rglob(exe)):
            raise SetupError(f"{item.name} has no llama-server inside")
        shutil.rmtree(llama_dir(), ignore_errors=True)
        staging.replace(llama_dir())
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        archive.unlink(missing_ok=True)
    found = downloaded_llama_server()
    if found is None:
        raise SetupError(f"{item.name} has no llama-server inside")
    if sys.platform != "win32":
        found.chmod(found.stat().st_mode | 0o111)
    return found


def download_models(config: Config, parts: list[str]) -> None:
    for part in parts:
        for item in MODELS[part]:
            target = config.models_path / item.name
            if target.exists() and target.stat().st_size == item.size:  # the hash is checked when the file is downloaded
                print(f"{item.name}: already there")
                continue
            print(f"{item.name} ({item.size / 1e6:.0f} MB)")
            fetch(item, target)
    if "translate" in parts:
        print(f"PLaMo 3 Translate is distributed under the PLaMo Community License: {MT_URL.split('/resolve')[0]}")


def run(config: Config, parts: list[str] | None = None) -> None:
    """Download the chosen parts: "server", "asr", "translate". Default: all."""
    parts = parts or PARTS
    if "server" in parts:
        download_server()
    download_models(config, [part for part in parts if part in MODELS])
    print(f"done. models: {config.models_path}")
