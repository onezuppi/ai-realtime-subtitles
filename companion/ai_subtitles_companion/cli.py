"""Commands: serve, bridge, install, uninstall, stop, status, check, config.

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
from typing import Callable

from . import bridge, config as cfg, install as installer, servers
from .cli_install import add_arguments as add_install_arguments, cmd_install
from .errors import SetupError

CONFIG_FIELDS = ("models_dir", "mt_model", "llama_server")


def _server_state(config: cfg.Config) -> dict[str, bool]:
    return {"asr": servers.is_ready(config.asr_port), "translate": servers.is_ready(config.mt_port)}


def cmd_bridge(args: argparse.Namespace, config: cfg.Config) -> int:
    bridge.main(config)
    return 0


def cmd_serve(args: argparse.Namespace, config: cfg.Config) -> int:
    state = servers.start(config)
    print(f"asr :{config.asr_port} {'ready' if state['asr'] else 'NOT ready'}, "
          f"translate :{config.mt_port} {'ready' if state['translate'] else 'NOT ready'}. Ctrl+C stops them.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"stopped {servers.stop()} process(es)")
    return 0


def cmd_stop(args: argparse.Namespace, config: cfg.Config) -> int:
    print(f"stopped {servers.stop()} process(es)")
    return 0


def cmd_status(args: argparse.Namespace, config: cfg.Config) -> int:
    print(_server_state(config))
    return 0


def cmd_check(args: argparse.Namespace, config: cfg.Config) -> int:
    print("registered for:", ", ".join(installer.registered_browsers()) or "no browser")
    print("servers:", _server_state(config))
    return 0


def cmd_uninstall(args: argparse.Namespace, config: cfg.Config) -> int:
    print("removed for:", ", ".join(installer.uninstall()) or "nothing")
    return 0


def cmd_config(args: argparse.Namespace, config: cfg.Config) -> int:
    for field in CONFIG_FIELDS:
        value = getattr(args, field)
        if value is not None:
            setattr(config, field, value)
    cfg.save(config)
    print(cfg.config_path())
    print(dataclasses.asdict(config))
    return 0


COMMANDS: dict[str, Callable[[argparse.Namespace, cfg.Config], int]] = {
    "serve": cmd_serve,
    "bridge": cmd_bridge,
    "stop": cmd_stop,
    "status": cmd_status,
    "install": cmd_install,
    "check": cmd_check,
    "uninstall": cmd_uninstall,
    "config": cmd_config,
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ai_subtitles_companion")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        command = sub.add_parser(name)
        if name == "install":
            add_install_arguments(command)
        elif name == "config":
            for field in CONFIG_FIELDS:
                command.add_argument("--" + field.replace("_", "-"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = cfg.load()
    except SetupError as error:
        if args.command != "bridge":
            print(f"error: {error}", file=sys.stderr)
            return 1
        # The browser cannot show stderr: keep the host running and answer every request with the error.
        bridge.main(cfg.Config(), config_error=str(error))
        return 0
    try:
        return COMMANDS[args.command](args, config)
    except SetupError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
