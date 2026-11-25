import os
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

from ai_subtitles_companion import localhttp, servers


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "http://127.0.0.1:1/elsewhere")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")


class LocalHttpTest(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def test_ignores_proxy_settings(self):
        # A dead proxy would make every request fail if the opener used it.
        with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "http_proxy": "http://127.0.0.1:1"}):
            with localhttp.opener.open(self.base + "/", timeout=3) as response:
                self.assertEqual(response.read(), b"ok")

    def test_does_not_follow_redirects(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            localhttp.opener.open(self.base + "/redirect", timeout=3)
        self.assertEqual(caught.exception.code, 302)

    def test_health_check_uses_it(self):
        with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "http_proxy": "http://127.0.0.1:1"}):
            self.assertTrue(servers.is_ready(self.server.server_port))


if __name__ == "__main__":
    unittest.main()
