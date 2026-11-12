"""Manual check: starts the bridge as the browser would and talks to the live llama servers.

    python companion/tests/smoke_bridge.py [path-to-16kHz-mono.wav]
"""
import base64
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from ai_subtitles_companion import bridge  # noqa: E402

process = subprocess.Popen([sys.executable, "-m", "ai_subtitles_companion", "bridge"], cwd=ROOT,
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE)


def call(message):
    process.stdin.write(bridge.encode_message(message))
    process.stdin.flush()
    return bridge.read_message(process.stdout)


print("status   ", call({"id": 1, "target": "companion", "path": "/status", "method": "GET"}))
print("asr      ", call({"id": 2, "target": "asr", "path": "/health", "method": "GET"}))
print("forbidden", call({"id": 3, "target": "asr", "path": "/props", "method": "GET"}))
if len(sys.argv) > 1:
    wav = Path(sys.argv[1]).read_bytes()
    pcm = wav[44:44 + 16000 * 2 * 4]
    header = wav[:44]
    header = header[:4] + struct.pack("<I", 36 + len(pcm)) + header[8:40] + struct.pack("<I", len(pcm))
    body = {"temperature": 0, "max_tokens": 96, "messages": [{"role": "user", "content": [
        {"type": "input_audio", "input_audio": {"data": base64.b64encode(header + pcm).decode(), "format": "wav"}}]}]}
    reply = call({"id": 4, "target": "asr", "path": "/v1/chat/completions", "method": "POST", "body": body})
    print("transcribe", reply["ok"], reply.get("data", {}).get("choices", [{}])[0].get("message", {}).get("content"))
    body = {"model": "plamo-3-translate", "temperature": 0, "max_tokens": 64, "stop": ["<|plamo:tag|>"],
            "chat_template_kwargs": {"target_lang": "ru"}, "messages": [{"role": "user", "content": "Good morning, how are you?"}]}
    reply = call({"id": 5, "target": "translate", "path": "/v1/chat/completions", "method": "POST", "body": body})
    print("translate ", reply["ok"], reply.get("data", {}).get("choices", [{}])[0].get("message", {}).get("content"))
process.stdin.close()
process.wait(timeout=10)
print("exit code", process.returncode)
