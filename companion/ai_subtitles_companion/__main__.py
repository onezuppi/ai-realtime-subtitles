"""Commands: serve, bridge, install, uninstall, stop, status.

  python -m ai_subtitles_companion serve      start the model servers and keep running (Ctrl+C stops them)
  python -m ai_subtitles_companion bridge     native messaging host (the browser starts this itself)
  python -m ai_subtitles_companion install    register the host for Chrome, Brave and Edge
  python -m ai_subtitles_companion config     show the settings file and set values: --models-dir PATH
"""
from __future__ import annotations

import argparse
import dataclasses
import sys
import time

from . import bridge, config as cfg, install as installer, servers

# Extension ID produced by the "key" in public/manifest.json. Same on every machine.
DEFAULT_EXTENSION_ID = "fdpmchjhigcggmmcilchcakdnocflcbf"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ai_subtitles_companion")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve")
    sub.add_parser("bridge")
    sub.add_parser("stop")
    sub.add_parser("status")
    install_cmd = sub.add_parser("install")
    install_cmd.add_argument("--extension-id", action="append", default=[], help="extension ID (repeatable)")
    install_cmd.add_argument("--browser", action="append", choices=list(installer.BROWSERS), help="default: all")
    sub.add_parser("uninstall")
    config_cmd = sub.add_parser("config")
    config_cmd.add_argument("--models-dir")
    config_cmd.add_argument("--mt-model")
    config_cmd.add_argument("--llama-server")
    args = parser.parse_args(argv)
    config = cfg.load()

    try:
        if args.command == "bridge":
            bridge.main(config)
        elif args.command == "serve":
            state = servers.start(config)
            print(f"asr :{config.asr_port} {'ready' if state['asr'] else 'NOT ready'}, "
                  f"translate :{config.mt_port} {'ready' if state['translate'] else 'NOT ready'}. Ctrl+C stops them.")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                print(f"stopped {servers.stop()} process(es)")
        elif args.command == "stop":
            print(f"stopped {servers.stop()} process(es)")
        elif args.command == "status":
            print({"asr": servers.is_ready(config.asr_port), "translate": servers.is_ready(config.mt_port)})
        elif args.command == "install":
            ids = args.extension_id or [DEFAULT_EXTENSION_ID]
            done = installer.install(ids, args.browser or list(installer.BROWSERS))
            print("registered for:", ", ".join(done))
        elif args.command == "uninstall":
            print("removed for:", ", ".join(installer.uninstall()) or "nothing")
        elif args.command == "config":
            for field in ("models_dir", "mt_model", "llama_server"):
                value = getattr(args, field)
                if value is not None:
                    setattr(config, field, value)
            cfg.save(config)
            print(cfg.config_path())
            print(dataclasses.asdict(config))
    except servers.SetupError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

