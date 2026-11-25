"""Native Messaging host. Relays requests from the extension to the local llama.cpp servers.

Protocol: every message is JSON with a 4-byte little-endian length in front (Chrome native messaging).

Request:  {"id": 1, "target": "asr" | "translate" | "companion", "path": "/v1/chat/completions",
           "method": "POST", "body": {...}}
Response: {"id": 1, "ok": true, "status": 200, "data": {...}}  or  {"id": 1, "ok": false, "error": "..."}

Targets are fixed names, not URLs, so the extension cannot make the host call other addresses.
"""
from __future__ import annotations

import json
import struct
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import IO, Any, Callable

from . import localhttp, servers
from .config import Config

# The paths each target accepts.
ALLOWED_PATHS = {
    "asr": {"/health", "/v1/chat/completions"},
    "translate": {"/health", "/v1/chat/completions"},
    "companion": {"/start", "/status"},
}
ALLOWED_METHODS = {"GET", "POST"}
MAX_BODY = 64 * 1024 * 1024  # largest message accepted from the browser, in bytes
REQUEST_TIMEOUT = 20  # seconds for model requests
HEALTH_TIMEOUT = 3  # seconds for /health
MAX_WORKERS = 4  # requests handled in parallel


def read_message(stream: IO[bytes]) -> dict[str, Any] | None:
    header = stream.read(4)
    if len(header) < 4:
        return None
    (size,) = struct.unpack("<I", header)
    if size > MAX_BODY:
        raise ValueError(f"message too large: {size}")
    payload = stream.read(size)
    if len(payload) < size:
        return None
    return json.loads(payload.decode("utf-8"))


def encode_message(message: dict[str, Any]) -> bytes:
    data = json.dumps(message, ensure_ascii=False).encode("utf-8")
    return struct.pack("<I", len(data)) + data


def _start_targets(body: Any) -> tuple[str, ...]:
    """The servers a /start request asks for: body {"targets": ["asr"]}, or both when the body has none."""
    targets = body.get("targets") if isinstance(body, dict) else None
    if targets is None:
        return servers.NAMES
    if not isinstance(targets, list) or not targets or not set(targets) <= set(servers.NAMES):
        raise servers.SetupError('targets must be a non-empty list of "asr" and "translate"')
    return tuple(dict.fromkeys(targets))


class Bridge:
    def __init__(self, config: Config, post: Callable[..., dict[str, Any]] | None = None,
                 config_error: str | None = None) -> None:
        self.config = config
        # Set when config.json could not be read: every request is answered with this error.
        self.config_error = config_error
        self._post = post or self._http
        self._ports = {"asr": config.asr_port, "translate": config.mt_port}

    def _http(self, port: int, path: str, method: str, body: Any, timeout: float) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method,
                                         headers={"content-type": "application/json"})
        try:
            with localhttp.opener.open(request, timeout=timeout) as response:
                text = response.read().decode("utf-8")
                return {"ok": True, "status": response.status, "data": json.loads(text) if text else None}
        except urllib.error.HTTPError as error:
            return {"ok": False, "status": error.code, "error": error.read().decode("utf-8", "replace")[:500]}
        except (OSError, ValueError) as error:
            return {"ok": False, "error": str(error)}

    def handle(self, message: dict[str, Any]) -> dict[str, Any]:
        reply: dict[str, Any] = {"id": message.get("id")}
        target, path = message.get("target"), message.get("path")
        if target not in ALLOWED_PATHS or path not in ALLOWED_PATHS[target]:
            return {**reply, "ok": False, "error": f"not allowed: {target} {path}"}
        method = message.get("method", "POST")
        if method not in ALLOWED_METHODS:
            return {**reply, "ok": False, "error": f"not allowed: method {method}"}
        if self.config_error:
            return {**reply, "ok": False, "error": self.config_error}
        try:
            if target == "companion":
                if path == "/start":
                    state = servers.start(self.config, names=_start_targets(message.get("body")))
                else:
                    state = {name: servers.is_ready(port) for name, port in self._ports.items()}
                return {**reply, "ok": all(state.values()), "status": 200, "data": state}
            if self.config.autostart and not servers.is_ready(self._ports[target]):
                servers.start(self.config)
            timeout = HEALTH_TIMEOUT if path == "/health" else REQUEST_TIMEOUT
            result = self._post(self._ports[target], path, method, message.get("body"), timeout)
            return {**reply, **result}
        except servers.SetupError as error:
            return {**reply, "ok": False, "error": str(error)}

    def serve(self, source: IO[bytes], sink: IO[bytes]) -> None:
        """Read requests until the browser closes the pipe. Requests run in parallel; writes are serialised."""
        lock = threading.Lock()

        def run(message: dict[str, Any]) -> None:
            try:
                reply = self.handle(message)
            except Exception as error:  # noqa: BLE001 - never let a request kill the host
                reply = {"id": message.get("id"), "ok": False, "error": repr(error)}
            with lock:
                sink.write(encode_message(reply))
                sink.flush()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            while (message := read_message(source)) is not None:
                pool.submit(run, message)


def main(config: Config, config_error: str | None = None) -> None:
    Bridge(config, config_error=config_error).serve(sys.stdin.buffer, sys.stdout.buffer)
