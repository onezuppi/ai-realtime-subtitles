import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai_subtitles_companion import HOST_NAME, install  # noqa: E402

IDS = ["abcdefghijklmnopabcdefghijklmnop"]


class PosixInstallTest(unittest.TestCase):
    """Runs the macOS and Linux code paths against a temporary home folder. The real system is not touched."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name) / "home"
        self.launch = Path(self._tmp.name) / "data"
        self.home.mkdir()
        self.launch.mkdir()

    def test_platform_keys(self):
        self.assertEqual(install.platform_key("win32"), "windows")
        self.assertEqual(install.platform_key("darwin"), "darwin")
        self.assertEqual(install.platform_key("linux"), "linux")
        self.assertEqual(install.platform_key("freebsd13"), "linux")

    def test_manifest_folders_follow_each_browser_convention(self):
        linux = install.host_manifest_dir("brave", "linux", self.home)
        mac = install.host_manifest_dir("chrome", "darwin", self.home)
        self.assertEqual(linux, self.home / ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts")
        self.assertEqual(mac, self.home / "Library/Application Support/Google/Chrome/NativeMessagingHosts")

    def test_install_writes_a_manifest_for_each_chosen_browser_only(self):
        for platform in ("linux", "darwin"):
            done = install.install(IDS, ["chrome", "brave"], platform, self.home, self.launch)
            self.assertEqual(done, ["chrome", "brave"])
            self.assertEqual(install.registered_browsers(platform, self.home), ["chrome", "brave"])
            data = json.loads((install.host_manifest_dir("chrome", platform, self.home) / f"{HOST_NAME}.json").read_text())
            self.assertEqual(data["name"], HOST_NAME)
            self.assertEqual(data["allowed_origins"], [f"chrome-extension://{IDS[0]}/"])
            self.assertTrue(Path(data["path"]).exists())
            self.assertFalse(install.host_manifest_dir("edge", platform, self.home).exists())

    def test_launcher_is_a_shell_script_that_starts_the_bridge(self):
        launcher = install.write_launcher("linux", self.launch)
        text = launcher.read_text()
        self.assertEqual(launcher.name, "host.sh")
        self.assertTrue(text.startswith("#!/bin/sh"))
        self.assertIn("-m ai_subtitles_companion bridge", text)

    def test_windows_launcher_is_a_bat_file(self):
        launcher = install.write_launcher("win32", self.launch)
        self.assertEqual(launcher.name, "host.bat")
        self.assertIn("ai_subtitles_companion bridge", launcher.read_text())

    def test_uninstall_removes_only_our_manifests(self):
        install.install(IDS, ["chrome", "edge"], "linux", self.home, self.launch)
        other = install.host_manifest_dir("chrome", "linux", self.home) / "other.host.json"
        other.write_text("{}")
        self.assertEqual(install.uninstall("linux", self.home), ["chrome", "edge"])
        self.assertEqual(install.registered_browsers("linux", self.home), [])
        self.assertTrue(other.exists())

    def test_detect_uses_profile_folders(self):
        with mock.patch("shutil.which", return_value=None):
            self.assertEqual(install.detect_browsers("linux", self.home), [])
            (self.home / ".config/chromium").mkdir(parents=True)
            (self.home / ".config/microsoft-edge").mkdir(parents=True)
            self.assertEqual(install.detect_browsers("linux", self.home), ["chromium", "edge"])

    def test_detect_uses_commands_on_the_path(self):
        with mock.patch("shutil.which", side_effect=lambda command: "/usr/bin/x" if command == "brave-browser" else None):
            self.assertEqual(install.detect_browsers("linux", self.home), ["brave"])


class BrowserNamesTest(unittest.TestCase):
    def test_every_system_offers_the_same_browsers(self):
        expected = ["chrome", "chromium", "brave", "edge"]
        for platform in ("win32", "darwin", "linux"):
            self.assertEqual(install.browser_names(platform), expected)


if __name__ == "__main__":
    unittest.main()
