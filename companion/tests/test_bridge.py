import io
import json
import unittest
from pathlib import Path
from unittest import mock

from ai_subtitles_companion import bridge, install
from ai_subtitles_companion.config import Config


def frame(message):
    return bridge.encode_message(message)


class FramingTest(unittest.TestCase):
    def test_round_trip(self):
        message = {"id": 1, "text": "привет"}
        self.assertEqual(bridge.read_message(io.BytesIO(frame(message))), message)

    def test_end_of_stream_returns_none(self):
        self.assertIsNone(bridge.read_message(io.BytesIO(b"")))
        self.assertIsNone(bridge.read_message(io.BytesIO(frame({"a": 1})[:-2])))

    def test_rejects_huge_length(self):
        with self.assertRaises(ValueError):
            bridge.read_message(io.BytesIO(b"\xff\xff\xff\x7f"))


class HandleTest(unittest.TestCase):
    def make(self, result=None):
        calls = []

        def post(port, path, method, body, timeout):
            calls.append((port, path, method, body, timeout))
            return result or {"ok": True, "status": 200, "data": {"choices": []}}

        config = Config(autostart=False, asr_port=1111, mt_port=2222)
        return bridge.Bridge(config, post), calls

    def test_routes_targets_to_their_ports(self):
        host, calls = self.make()
        host.handle({"id": 1, "target": "asr", "path": "/v1/chat/completions", "method": "POST", "body": {"x": 1}})
        host.handle({"id": 2, "target": "translate", "path": "/v1/chat/completions", "method": "POST", "body": {}})
        self.assertEqual([c[0] for c in calls], [1111, 2222])
        self.assertEqual(calls[0][3], {"x": 1})

    def test_start_passes_the_requested_targets_to_the_servers(self):
        host, _ = self.make()
        with mock.patch.object(bridge.servers, "start", return_value={"asr": True}) as start:
            reply = host.handle({"id": 5, "target": "companion", "path": "/start", "method": "POST",
                                 "body": {"targets": ["asr"]}})
            self.assertEqual(start.call_args.kwargs["names"], ("asr",))
            self.assertTrue(reply["ok"])
            host.handle({"id": 6, "target": "companion", "path": "/start", "method": "POST"})
            self.assertEqual(start.call_args.kwargs["names"], ("asr", "translate"))

    def test_start_refuses_targets_that_are_not_servers(self):
        host, _ = self.make()
        for body in ({"targets": ["evil"]}, {"targets": []}, {"targets": "asr"}):
            reply = host.handle({"id": 7, "target": "companion", "path": "/start", "method": "POST", "body": body})
            self.assertFalse(reply["ok"], body)
            self.assertIn("targets", reply["error"])

    def test_keeps_the_request_id(self):
        host, _ = self.make()
        reply = host.handle({"id": 42, "target": "asr", "path": "/health", "method": "GET"})
        self.assertEqual(reply["id"], 42)
        self.assertTrue(reply["ok"])

    def test_rejects_unknown_targets_and_paths(self):
        host, calls = self.make()
        for message in (
            {"id": 1, "target": "evil", "path": "/health"},
            {"id": 2, "target": "asr", "path": "/props"},
            {"id": 3, "target": "asr", "path": "http://example.com/"},
        ):
            reply = host.handle(message)
            self.assertFalse(reply["ok"])
            self.assertIn("not allowed", reply["error"])
        self.assertEqual(calls, [])

    def test_rejects_methods_other_than_get_and_post(self):
        host, calls = self.make()
        reply = host.handle({"id": 1, "target": "asr", "path": "/health", "method": "DELETE"})
        self.assertFalse(reply["ok"])
        self.assertIn("not allowed", reply["error"])
        self.assertEqual(calls, [])

    def test_answers_every_request_with_the_config_error(self):
        host = bridge.Bridge(Config(autostart=False), lambda *a: self.fail("must not call"),
                             config_error="config.json is invalid: x")
        for target, path in (("asr", "/health"), ("companion", "/status")):
            reply = host.handle({"id": 5, "target": target, "path": path, "method": "GET"})
            self.assertEqual((reply["id"], reply["ok"], reply["error"]), (5, False, "config.json is invalid: x"))

    def test_passes_server_errors_through(self):
        host, _ = self.make({"ok": False, "status": 500, "error": "boom"})
        reply = host.handle({"id": 1, "target": "asr", "path": "/health", "method": "GET"})
        self.assertEqual((reply["ok"], reply["status"], reply["error"]), (False, 500, "boom"))


class ServeTest(unittest.TestCase):
    def test_serves_requests_until_the_pipe_closes(self):
        host = bridge.Bridge(Config(autostart=False), lambda *a: {"ok": True, "status": 200, "data": "pong"})
        source = io.BytesIO(
            frame({"id": 1, "target": "asr", "path": "/health", "method": "GET"})
            + frame({"id": 2, "target": "translate", "path": "/health", "method": "GET"})
        )
        sink = io.BytesIO()
        host.serve(source, sink)
        sink.seek(0)
        replies = []
        while (reply := bridge.read_message(sink)) is not None:
            replies.append(reply)
        self.assertEqual(sorted(r["id"] for r in replies), [1, 2])
        self.assertTrue(all(r["data"] == "pong" for r in replies))

    def test_a_crashing_handler_does_not_kill_the_host(self):
        def boom(*args):
            raise RuntimeError("bad")

        host = bridge.Bridge(Config(autostart=False), boom)
        sink = io.BytesIO()
        host.serve(io.BytesIO(frame({"id": 7, "target": "asr", "path": "/health", "method": "GET"})), sink)
        sink.seek(0)
        reply = bridge.read_message(sink)
        self.assertEqual(reply["id"], 7)
        self.assertFalse(reply["ok"])


class ManifestTest(unittest.TestCase):
    def test_allows_only_the_given_extension(self):
        data = install.manifest(Path("C:/x/host.bat"), ["abc", "def"])
        self.assertEqual(data["allowed_origins"], ["chrome-extension://abc/", "chrome-extension://def/"])
        self.assertEqual(data["type"], "stdio")
        json.dumps(data)


if __name__ == "__main__":
    unittest.main()
