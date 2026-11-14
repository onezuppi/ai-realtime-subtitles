import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ai_subtitles_companion import locate, servers
from ai_subtitles_companion.config import Config

ASR, MT = 1111, 2222


class FakeProcess:
    def __init__(self, pid, code=None):
        self.pid, self.code = pid, code

    def poll(self):
        return self.code


class TempDataFolder(unittest.TestCase):
    """Points the data folder at a temporary directory. No real process is started or stopped."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        for patcher in (mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.root), "LLAMA_SERVER": ""}),
                        mock.patch("time.sleep")):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.folder = self.root / "ai-realtime-subtitles"
        self.config = Config(models_dir=str(self.root), asr_port=ASR, mt_port=MT)


class BuildCommandsTest(TempDataFolder):
    def test_each_server_gets_its_model_port_and_the_common_options(self):
        commands = servers.build_commands(Config(models_dir="/m", asr_port=ASR, mt_port=MT, extra_args=["-t", "4"]),
                                          Path("/bin/llama-server"))
        for name, port in (("asr", ASR), ("translate", MT)):
            command = commands[name]
            self.assertEqual(command[command.index("--port") + 1], str(port))
            self.assertEqual(command[command.index("-c") + 1], "4096")
            self.assertEqual(command[command.index("-ngl") + 1], "99")
            self.assertEqual(command[-2:], ["-t", "4"])
        self.assertIn("--mmproj", commands["asr"])

    def test_find_llama_server_uses_the_configured_path(self):
        exe = self.root / "llama-server.exe"
        exe.write_text("")
        self.assertEqual(servers.find_llama_server(Config(llama_server=str(exe))), exe)
        with self.assertRaises(servers.SetupError):
            servers.find_llama_server(Config(llama_server=str(self.root / "missing")))

    def test_find_llama_server_picks_the_newest_lm_studio_build(self):
        exe = "llama-server.exe" if locate.sys.platform == "win32" else "llama-server"
        pattern = locate.LM_STUDIO_PATTERNS.get(locate.sys.platform, locate.LM_STUDIO_PATTERNS_DEFAULT)[0]
        for version in ("1.9.0", "1.10.2", "1.2.9"):
            folder = self.root / pattern.replace("*", version)
            folder.mkdir()
            (folder / exe).write_text("")
        with mock.patch("shutil.which", return_value=None), mock.patch.object(locate, "LM_STUDIO_BACKENDS", self.root):
            found = servers.find_llama_server(Config())
        self.assertEqual(found.parent.name, pattern.replace("*", "1.10.2"))


class StartStopTest(TempDataFolder):
    def start(self, ready, popen):
        with mock.patch.object(servers, "is_ready", side_effect=lambda port, timeout=1.5: port in ready), \
                mock.patch.object(servers, "model_files"), \
                mock.patch.object(servers, "find_llama_server", return_value=Path("llama-server")), \
                mock.patch("subprocess.Popen", side_effect=popen):
            return servers.start(self.config, wait_seconds=5)

    def test_starting_one_server_keeps_the_pid_of_the_other(self):
        self.folder.mkdir()
        servers.pid_file("asr").write_text("111")
        ready = {ASR}

        def popen(command, **kwargs):
            ready.add(MT)
            return FakeProcess(222)

        self.assertEqual(self.start(ready, popen), {"asr": True, "translate": True})
        self.assertEqual(servers.pid_file("asr").read_text(), "111")
        self.assertEqual(servers.pid_file("translate").read_text(), "222")
        with mock.patch.object(servers, "_kill", return_value=True) as kill:
            self.assertEqual(servers.stop(), 2)
        self.assertEqual(sorted(call.args[0] for call in kill.call_args_list), ["111", "222"])
        self.assertEqual(list(self.folder.glob("*.pid")), [])

    def test_stop_also_reads_the_old_single_pid_file(self):
        self.folder.mkdir()
        (self.folder / "servers.pid").write_text("10\n20")
        with mock.patch.object(servers, "_kill", return_value=True) as kill:
            self.assertEqual(servers.stop(), 2)
        self.assertEqual([call.args[0] for call in kill.call_args_list], ["10", "20"])
        self.assertFalse((self.folder / "servers.pid").exists())

    def test_stop_without_pid_files_does_nothing(self):
        self.assertEqual(servers.stop(), 0)
        self.assertFalse(self.folder.exists())

    def test_a_server_that_exits_at_once_fails_fast_with_the_log(self):
        self.folder.mkdir()
        (self.folder / "servers.log").write_text("error: failed to load model\n")
        with self.assertRaises(servers.SetupError) as caught:
            self.start(set(), lambda command, **kwargs: FakeProcess(333, code=1))
        self.assertIn("exited with code 1", str(caught.exception))
        self.assertIn("failed to load model", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
