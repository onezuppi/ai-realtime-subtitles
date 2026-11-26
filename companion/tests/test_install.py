import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import ai_subtitles_companion
from ai_subtitles_companion import HOST_NAME, install
from ai_subtitles_companion.install import launcher, windows

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


class LauncherTest(unittest.TestCase):
    def test_launcher_changes_into_the_folder_that_holds_the_package(self):
        package_parent = Path(ai_subtitles_companion.__file__).resolve().parent.parent
        self.assertEqual(launcher.PACKAGE_ROOT, package_parent)
        with tempfile.TemporaryDirectory() as folder:
            bat = install.write_launcher("win32", Path(folder)).read_text()
            sh = install.write_launcher("linux", Path(folder)).read_text()
        self.assertIn(f'cd /d "{package_parent}"', bat)
        self.assertIn(f'cd "{launcher._sh_quoted(package_parent)}" || exit 1', sh)

    def test_packaged_build_is_registered_directly(self):
        with tempfile.TemporaryDirectory() as root:
            download = Path(root) / "download" / "companion.exe"
            download.parent.mkdir()
            download.write_bytes(b"program")
            data = Path(root) / "data"
            data.mkdir()
            with mock.patch.object(sys, "frozen", True, create=True), mock.patch.object(sys, "executable", str(download)):
                for platform in ("win32", "linux", "darwin"):
                    self.assertEqual(install.write_launcher(platform, data), data / "companion.exe")
            self.assertEqual((data / "companion.exe").read_bytes(), b"program")
            self.assertEqual(sorted(path.name for path in data.iterdir()), ["companion.exe"])  # no .bat or .sh

    def test_bat_doubles_percent_signs(self):
        text = launcher.bat_text(Path("C:/a%PATH%b"), "C:/py/python.exe")
        self.assertIn("a%%PATH%%b", text)
        with self.assertRaises(ValueError):
            launcher.bat_text(Path("C:/x"), 'C:/"py"/python.exe')

    def test_sh_escapes_characters_special_inside_double_quotes(self):
        text = launcher.sh_text('/home/a$b`c\\d"e', "/usr/bin/python3")
        self.assertIn(r'cd "/home/a\$b\`c\\d\"e" || exit 1', text)
        self.assertIn('exec "/usr/bin/python3" -m ai_subtitles_companion bridge', text)


class WindowsRegistryTest(unittest.TestCase):
    """Runs the Windows code path against a fake registry."""

    def _install(self, browsers):
        written = {}
        fake = mock.MagicMock()
        fake.HKEY_CURRENT_USER = "HKCU"

        def create_key(hive, path):
            context = mock.MagicMock()
            context.__enter__.return_value = path
            return context

        fake.CreateKey.side_effect = create_key
        fake.SetValueEx.side_effect = lambda path, name, reserved, kind, value: written.setdefault(path, value)
        with tempfile.TemporaryDirectory() as folder, mock.patch.dict("sys.modules", {"winreg": fake}):
            windows.install("{}", browsers, Path(folder))
        return sorted(written)

    def test_brave_is_also_registered_under_the_chrome_key(self):
        self.assertEqual(self._install(["brave"]), sorted([
            rf"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\{HOST_NAME}",
            rf"Software\Google\Chrome\NativeMessagingHosts\{HOST_NAME}",
        ]))

    def test_each_key_gets_its_own_manifest_that_keeps_earlier_origins(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            fake = mock.MagicMock()
            fake.HKEY_CURRENT_USER = "HKCU"
            with mock.patch.dict("sys.modules", {"winreg": fake}):
                windows.install('{"allowed_origins": ["chrome-extension://a/"]}', ["brave"], folder)
                windows.install('{"allowed_origins": ["chrome-extension://b/"]}', ["chrome"], folder)
                brave = json.loads((folder / f"{HOST_NAME}.brave.json").read_text(encoding="utf-8"))
                chrome = json.loads((folder / f"{HOST_NAME}.chrome.json").read_text(encoding="utf-8"))
                self.assertEqual(brave["allowed_origins"], ["chrome-extension://a/"])
                self.assertEqual(chrome["allowed_origins"], ["chrome-extension://b/", "chrome-extension://a/"])
                fake.DeleteKey.side_effect = FileNotFoundError
                windows.uninstall(folder)
            self.assertEqual(list(folder.glob("*.json")), [])

    def test_other_browsers_get_only_their_own_key(self):
        self.assertEqual(self._install(["edge"]), [rf"Software\Microsoft\Edge\NativeMessagingHosts\{HOST_NAME}"])


class BrowserNamesTest(unittest.TestCase):
    def test_every_system_offers_the_same_browsers(self):
        expected = ["chrome", "chromium", "brave", "edge"]
        for platform in ("win32", "darwin", "linux"):
            self.assertEqual(install.browser_names(platform), expected)


if __name__ == "__main__":
    unittest.main()
