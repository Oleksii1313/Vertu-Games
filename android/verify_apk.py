#!/usr/bin/env python3
"""Check an Android APK archive contains the complete VertGames offline app."""
from __future__ import annotations

import hashlib
import sys
import zipfile
from pathlib import Path

EXPECTED_GAMES = (
    "flappy.html", "game2048.html", "platformer.html", "pong.html", "shooter.html",
    "snake.html", "minicraft.html", "doodle.html", "redline.html", "sky-isle.html",
    "chefs-rover.html",
)
REQUIRED_ENTRIES = (
    "AndroidManifest.xml", "classes.dex", "resources.arsc",
    "assets/www/index.html", "assets/www/top.html", "assets/www/roulette.html",
    "assets/www/admin.html", "assets/www/about.html", "assets/www/support.html",
    "assets/www/api.html", "assets/www/privacy.html",
    "assets/www/assets/redline/car-pack.glb", "assets/www/assets/redline/gt-r34.glb",
)


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python3 android/verify_apk.py path/to/app-release.apk", file=sys.stderr)
        return 2
    apk = Path(sys.argv[1])
    if not apk.is_file():
        print(f"APK not found: {apk}", file=sys.stderr)
        return 2
    try:
        with zipfile.ZipFile(apk) as archive:
            names = set(archive.namelist())
            missing = [name for name in REQUIRED_ENTRIES if name not in names]
            missing_games = [f"assets/www/games/{name}" for name in EXPECTED_GAMES
                             if f"assets/www/games/{name}" not in names]
            dex_files = [name for name in names if name.startswith("classes") and name.endswith(".dex")]
            if missing or missing_games or not dex_files:
                for name in missing + missing_games:
                    print(f"FAIL: APK is missing {name}")
                if not dex_files:
                    print("FAIL: APK has no Dalvik bytecode")
                return 1
            if any(name.endswith(".pyc") or "/__pycache__/" in name for name in names):
                print("FAIL: Python cache files were packaged in the APK")
                return 1
            digest = hashlib.sha256(apk.read_bytes()).hexdigest()
            print("APK structure verification PASS")
            print(f"File: {apk}")
            print(f"Size: {apk.stat().st_size:,} bytes")
            print(f"SHA-256: {digest}")
            print(f"DEX files: {len(dex_files)}; games: {len(EXPECTED_GAMES)}")
            return 0
    except (OSError, zipfile.BadZipFile) as error:
        print(f"FAIL: unreadable APK: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
