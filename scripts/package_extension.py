"""Pack dist/ into release/ai-realtime-subtitles-<version>.zip and check that every version matches.

  python scripts/package_extension.py [--tag v0.1.0]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def versions() -> dict[str, str]:
    pyproject = (ROOT / "companion" / "pyproject.toml").read_text(encoding="utf-8")
    return {
        "package.json": json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"],
        "public/manifest.json": json.loads((ROOT / "public" / "manifest.json").read_text(encoding="utf-8"))["version"],
        "companion/pyproject.toml": re.search(r'^version = "([^"]+)"', pyproject, re.M).group(1),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", help="release tag; must equal the version, for example v0.1.0")
    args = parser.parse_args()

    found = versions()
    if len(set(found.values())) != 1:
        print(f"error: versions differ: {found}", file=sys.stderr)
        return 1
    version = next(iter(found.values()))
    if args.tag and args.tag != f"v{version}":
        print(f"error: tag {args.tag} does not match version {version}", file=sys.stderr)
        return 1

    dist = ROOT / "dist"
    if not (dist / "manifest.json").exists():
        print("error: dist/manifest.json not found, run `pnpm build` first", file=sys.stderr)
        return 1
    out = ROOT / "release" / f"ai-realtime-subtitles-{version}.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(dist).as_posix())
    print(f"{out} ({out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
