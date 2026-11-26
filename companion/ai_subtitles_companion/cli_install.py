"""The `install` command: pick browsers, explain what will change, ask, then register the host."""
from __future__ import annotations

import argparse
import sys

from . import download, install as installer
from .config import Config
from .errors import SetupError
from .locate import find_llama_server

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

ACTION_WINDOWS = ("writes one registry key per browser under HKEY_CURRENT_USER that points to a small manifest file\n"
                  "in the program's data folder.")
ACTION_POSIX = ("writes one small manifest file per browser into the NativeMessagingHosts folder of its\n"
                "profile directory in your home folder.")


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--extension-id", action="append", default=[], help="extension ID (repeatable)")
    parser.add_argument("--browser", action="append", choices=installer.browser_names(),
                        help="default: choose from the installed ones")
    parser.add_argument("--yes", "-y", action="store_true", help="do not ask for confirmation")
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument("--download", action="store_true", help="also download llama-server and the models")
    choice.add_argument("--no-download", action="store_true", help="do not offer the download")


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


def _pick_browsers(args: argparse.Namespace) -> list[str] | None:
    """The browsers to install for, or None after printing why there are none."""
    browsers = args.browser or installer.detect_browsers()
    if not browsers:
        print("error: no Chrome, Chromium, Brave or Edge found. Use --browser to choose one.", file=sys.stderr)
        return None
    if not args.browser and not args.yes:
        browsers = choose_browsers(browsers)
        if not browsers:
            print("cancelled")
            return None
    return browsers


def cmd_install(args: argparse.Namespace, config: Config) -> int:
    ids = args.extension_id or [DEFAULT_EXTENSION_ID]
    browsers = _pick_browsers(args)
    if browsers is None:
        return 1
    action = ACTION_WINDOWS if installer.platform_key() == "windows" else ACTION_POSIX
    print(INSTALL_NOTE.format(browsers=", ".join(browsers), ids=", ".join(ids), action=action))
    if not args.yes and input("Continue? [y/N] ").strip().lower() not in ("y", "yes"):
        print("cancelled")
        return 1
    done = installer.install(ids, browsers)
    print("registered for:", ", ".join(done))
    if _wants_download(args, config):
        download.run(config)
    print("Restart the browser, then choose 'Bridge' in the extension popup.")
    return 0


def _wants_download(args: argparse.Namespace, config: Config) -> bool:
    """Offer the download of what is still missing. --yes alone never starts a 3 GB download."""
    try:
        have_server = find_llama_server(config)
    except SetupError:
        have_server = None
    if have_server and not download.missing_models(config):
        return False
    if args.download:
        return True
    if args.no_download or args.yes:
        print("llama-server or model files are missing. Run the `download` command to fetch them (about 2.9 GB).")
        return False
    return input("llama-server and the models are missing. Download them now, about 2.9 GB? [Y/n] ").strip().lower()         not in ("n", "no")
