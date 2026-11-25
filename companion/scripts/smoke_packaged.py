"""CI check of the packaged program: starts it the way the browser starts a registered host and talks to it.

    python companion/scripts/smoke_packaged.py path/to/subtitles-companion[.exe]

The browser passes the extension origin as the argument. No models or servers are needed: /status only reports
whether the servers answer, and a request outside the allowed list must be refused.
"""
import struct
import subprocess
import sys

ORIGIN = "chrome-extension://fdpmchjhigcggmmcilchcakdnocflcbf/"


def send(process, message):
    import json
    data = json.dumps(message).encode("utf-8")
    process.stdin.write(struct.pack("<I", len(data)) + data)
    process.stdin.flush()


def receive(process):
    import json
    header = process.stdout.read(4)
    if len(header) < 4:
        raise SystemExit("the program closed the pipe without an answer")
    (size,) = struct.unpack("<I", header)
    return json.loads(process.stdout.read(size).decode("utf-8"))


def main() -> int:
    process = subprocess.Popen([sys.argv[1], ORIGIN], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        send(process, {"id": 7, "target": "companion", "path": "/status", "method": "GET"})
        status = receive(process)
        assert status["id"] == 7 and status["status"] == 200, status
        assert set(status["data"]) == {"asr", "translate"}, status
        send(process, {"id": 8, "target": "asr", "path": "/props", "method": "GET"})
        refused = receive(process)
        assert refused["id"] == 8 and refused["ok"] is False and "not allowed" in refused["error"], refused
    finally:
        process.stdin.close()
    code = process.wait(timeout=20)
    assert code == 0, f"exit code {code}"
    print("packaged bridge ok:", status["data"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
