import hashlib
import io
import tarfile
import tempfile
import threading
import unittest
import zipfile
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from unittest import mock

from ai_subtitles_companion import download
from ai_subtitles_companion.config import Config
from ai_subtitles_companion.errors import SetupError


class RangeHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler plus single-range requests, which `fetch` uses to resume."""

    def log_message(self, *args):
        pass

    def do_GET(self):
        header = self.headers.get("Range")
        if not header:
            return super().do_GET()
        data = Path(self.translate_path(self.path)).read_bytes()
        start = int(header.split("=")[1].rstrip("-"))
        self.send_response(206)
        self.send_header("Content-Length", str(len(data) - start))
        self.end_headers()
        self.wfile.write(data[start:])


class FetchTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        (self.root / "www").mkdir()
        self.data = bytes(range(256)) * 400
        (self.root / "www" / "file.bin").write_bytes(self.data)
        server = HTTPServer(("127.0.0.1", 0), partial(RangeHandler, directory=str(self.root / "www")))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.url = f"http://127.0.0.1:{server.server_port}/file.bin"

    def item(self, **changes):
        values = dict(name="file.bin", url=self.url, size=len(self.data), sha256=hashlib.sha256(self.data).hexdigest())
        return download.Item(**{**values, **changes})

    def quiet(self, *args):
        pass

    def test_downloads_and_checks_the_file(self):
        target = self.root / "out" / "file.bin"
        download.fetch(self.item(), target, self.quiet)
        self.assertEqual(target.read_bytes(), self.data)
        self.assertFalse(target.with_name("file.bin.part").exists())

    def test_resumes_from_the_part_file(self):
        target = self.root / "file.bin"
        target.with_name("file.bin.part").write_bytes(self.data[:1000])
        download.fetch(self.item(), target, self.quiet)
        self.assertEqual(target.read_bytes(), self.data)

    def test_wrong_hash_is_refused_and_leaves_no_file(self):
        target = self.root / "file.bin"
        with self.assertRaises(SetupError):
            download.fetch(self.item(sha256="0" * 64), target, self.quiet)
        self.assertFalse(target.exists())
        self.assertFalse(target.with_name("file.bin.part").exists())

    def test_unreachable_server_reports_how_to_resume(self):
        with self.assertRaisesRegex(SetupError, "resume"):
            download.fetch(self.item(url="http://127.0.0.1:1/x"), self.root / "file.bin", self.quiet)


class ExtractTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)

    def test_unpacks_zip_and_tar(self):
        archive = self.root / "a.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("llama-server.exe", "x")
        download.extract(archive, self.root / "zip")
        self.assertTrue((self.root / "zip" / "llama-server.exe").exists())

        archive = self.root / "a.tar.gz"
        with tarfile.open(archive, "w:gz") as tarred:
            info = tarfile.TarInfo("llama-b1/llama-server")
            info.size = 1
            tarred.addfile(info, io.BytesIO(b"x"))
        download.extract(archive, self.root / "tar")
        self.assertTrue((self.root / "tar" / "llama-b1" / "llama-server").exists())

    def test_entries_outside_the_target_are_refused(self):
        archive = self.root / "bad.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("../escape.txt", "x")
        with self.assertRaises(SetupError):
            download.extract(archive, self.root / "target")
        self.assertFalse((self.root / "escape.txt").exists())

        archive = self.root / "bad.tar.gz"
        with tarfile.open(archive, "w:gz") as tarred:
            info = tarfile.TarInfo("../escape.txt")
            info.size = 1
            tarred.addfile(info, io.BytesIO(b"x"))
        with self.assertRaises(SetupError):
            download.extract(archive, self.root / "target")


class CatalogTest(unittest.TestCase):
    def test_every_file_is_pinned(self):
        items = [*download.LLAMA_ARCHIVES.values(), *(i for part in download.MODELS.values() for i in part)]
        for item in items:
            self.assertTrue(item.url.startswith("https://"), item.name)
            self.assertEqual(len(item.sha256), 64, item.name)
            self.assertGreater(item.size, 0, item.name)

    def test_model_names_match_the_default_config(self):
        config = Config()
        names = {item.name for part in download.MODELS.values() for item in part}
        self.assertEqual(names, {config.asr_model, config.asr_mmproj, config.mt_model})

    def test_missing_models_lists_what_is_absent(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Config(models_dir=folder)
            self.assertEqual(len(download.missing_models(config)), 3)
            (Path(folder) / config.mt_model).write_bytes(b"x")
            self.assertNotIn(config.mt_model, download.missing_models(config))

    def test_unknown_platform_asks_for_a_manual_install(self):
        with mock.patch.object(download, "_system", return_value="freebsd"):
            with self.assertRaisesRegex(SetupError, "llama_server"):
                download.download_server()


if __name__ == "__main__":
    unittest.main()
