"""The native messaging host manifest that the browser reads to find and authorise the host."""
from __future__ import annotations

import json
from pathlib import Path

from .. import HOST_NAME

MANIFEST_FILE = f"{HOST_NAME}.json"


def manifest(launcher: Path, extension_ids: list[str]) -> dict:
    return {
        "name": HOST_NAME,
        "description": "AI Realtime Subtitles companion",
        "path": str(launcher),
        "type": "stdio",
        "allowed_origins": [f"chrome-extension://{extension_id}/" for extension_id in extension_ids],
    }


def manifest_text(launcher: Path, extension_ids: list[str]) -> str:
    return json.dumps(manifest(launcher, extension_ids), indent=2)
