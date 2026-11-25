import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ai_subtitles_companion import cli, config as cfg
from ai_subtitles_companion.errors import SetupError


class ConfigTest(unittest.TestCase):
    """Points the data folder at a temporary directory. The real config.json is not touched."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name)
        patcher = mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.base)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.folder = self.base / "ai-realtime-subtitles"

    def test_app_dir_does_not_create_the_folder(self):
        self.assertEqual(cfg.app_dir(), self.folder)
        self.assertEqual(cfg.load(), cfg.Config())
        self.assertFalse(self.folder.exists())

    def test_save_creates_the_folder_and_load_reads_it_back(self):
        cfg.save(cfg.Config(models_dir="D:/models", asr_port=9000))
        loaded = cfg.load()
        self.assertEqual((loaded.models_dir, loaded.asr_port), ("D:/models", 9000))

    def test_unknown_keys_are_ignored(self):
        self.folder.mkdir()
        cfg.config_path().write_text(json.dumps({"mt_port": 1234, "future_option": 1}), encoding="utf-8")
        self.assertEqual(cfg.load().mt_port, 1234)

    def test_values_of_the_wrong_type_or_range_are_refused(self):
        self.folder.mkdir()
        bad = [{"asr_port": "8083"}, {"asr_port": 0}, {"mt_port": 70000}, {"asr_port": True},
               {"asr_port": 9000, "mt_port": 9000}, {"models_dir": 5}, {"autostart": "yes"},
               {"extra_args": "-ngl 0"}, {"extra_args": [1]}]
        for values in bad:
            cfg.config_path().write_text(json.dumps(values), encoding="utf-8")
            with self.assertRaises(SetupError, msg=str(values)):
                cfg.load()

    def test_corrupt_json_raises_setup_error(self):
        self.folder.mkdir()
        for text in ("{not json", "[1, 2]", "\xff"):
            cfg.config_path().write_text(text, encoding="latin-1")
            with self.assertRaises(SetupError) as caught:
                cfg.load()
            self.assertTrue(str(caught.exception).startswith("config.json is invalid: "))

    def test_bridge_still_starts_with_a_corrupt_config(self):
        self.folder.mkdir()
        cfg.config_path().write_text("{not json", encoding="utf-8")
        with mock.patch.object(cli.bridge, "main") as bridge_main:
            self.assertEqual(cli.main(["bridge"]), 0)
        self.assertIn("config.json is invalid", bridge_main.call_args.kwargs["config_error"])

    def test_browser_start_with_the_extension_origin_runs_the_bridge(self):
        with mock.patch.object(cli.bridge, "main") as bridge_main:
            self.assertEqual(cli.main(["chrome-extension://abcdefghijklmnopabcdefghijklmnop/", "--parent-window=0"]), 0)
        bridge_main.assert_called_once()

    def test_other_commands_report_a_corrupt_config(self):
        self.folder.mkdir()
        cfg.config_path().write_text("{not json", encoding="utf-8")
        with mock.patch("sys.stderr") as stderr:
            self.assertEqual(cli.main(["status"]), 1)
        self.assertIn("config.json is invalid", "".join(c.args[0] for c in stderr.write.call_args_list))


if __name__ == "__main__":
    unittest.main()
