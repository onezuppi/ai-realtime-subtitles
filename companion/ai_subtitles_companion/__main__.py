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


INSTALL_NOTE = """\
Bridge installation

Why: some browsers cannot reach programs on this computer over HTTP (127.0.0.1). This happens with
browser extensions that route all traffic through a VPN or proxy, with Tor windows, and with strict
network policies. The bridge uses Native Messaging instead: the browser starts this program directly
and talks to it through a pipe, so no network is involved.

What this does: {action}
Only the extension with ID(s) {ids} may use it. No administrator rights are needed.
Browsers: {browsers}
Undo: python -m ai_subtitles_companion uninstall
"""


def choose_browsers(found: list[str]) -> list[str]:
    """Ask which of the detected browsers to install for. Enter or 'a' means all, 'q' cancels."""
    print("Found browsers:")
    for number, name in enumerate(found, 1):
        print(f"  {number}) {name}")
    answer = input("Install for which? Numbers separated by commas, Enter = all, q = cancel: ").strip().lower()
    if answer in ("q", "quit"):
        return []
    if answer in ("", "a", "all"):
        return found
    chosen = []
    for part in answer.replace(" ", "").split(","):
        if not part.isdigit() or not 1 <= int(part) <= len(found):
            print(f"error: '{part}' is not a number from 1 to {len(found)}", file=sys.stderr)
            return []
        if found[int(part) - 1] not in chosen:
            chosen.append(found[int(part) - 1])
    return chosen


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ai_subtitles_companion")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve")
    sub.add_parser("bridge")
    sub.add_parser("stop")
    sub.add_parser("status")
    install_cmd = sub.add_parser("install")
    install_cmd.add_argument("--extension-id", action="append", default=[], help="extension ID (repeatable)")
    install_cmd.add_argument("--browser", action="append", choices=installer.browser_names(), help="default: choose from the installed ones")
    install_cmd.add_argument("--yes", "-y", action="store_true", help="do not ask for confirmation")
    sub.add_parser("check")
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
            browsers = args.browser or installer.detect_browsers()
            if not browsers:
                print("error: no Chrome, Chromium, Brave or Edge found. Use --browser to choose one.", file=sys.stderr)
                return 1
            if not args.browser and not args.yes:
                browsers = choose_browsers(browsers)
                if not browsers:
                    print("cancelled")
                    return 1
            action = (
                "writes one registry key per browser under HKEY_CURRENT_USER that points to a small manifest file\nin the program's data folder."
                if installer.platform_key() == "windows"
                else "writes one small manifest file per browser into the NativeMessagingHosts folder of its\nprofile directory in your home folder."
            )
            print(INSTALL_NOTE.format(browsers=", ".join(browsers), ids=", ".join(ids), action=action))
            if not args.yes and input("Continue? [y/N] ").strip().lower() not in ("y", "yes"):
                print("cancelled")
                return 1
            done = installer.install(ids, browsers)
            print("registered for:", ", ".join(done))
            print("Restart the browser, then pick 'Program via bridge' in the extension popup.")
        elif args.command == "check":
            print("registered for:", ", ".join(installer.registered_browsers()) or "no browser")
            print("servers:", {"asr": servers.is_ready(config.asr_port), "translate": servers.is_ready(config.mt_port)})
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

