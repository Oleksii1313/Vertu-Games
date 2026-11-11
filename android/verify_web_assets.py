#!/usr/bin/env python3
"""Offline asset and local-link smoke checks for VertGames' Android bundle."""
from __future__ import annotations

import gzip
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
STATIC_PAGES = (
    "index.html", "top.html", "roulette.html", "admin.html",
    "about.html", "support.html", "api.html", "privacy.html",
)
GAME_FILES = (
    "games/flappy.html", "games/game2048.html", "games/platformer.html",
    "games/pong.html", "games/shooter.html", "games/snake.html",
    "games/minicraft.html", "games/doodle.html", "games/redline.html",
    "games/sky-isle.html", "games/chefs-rover.html",
)
BUNDLED_ROOT_FILES = (*STATIC_PAGES, "database.js", "auth-client.js", "coin.svg")


class LocalReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for name, value in attrs:
            if value and name.lower() in {"href", "src", "poster", "data"}:
                self.references.append(value)
            elif value and name.lower() == "srcset":
                for candidate in value.split(","):
                    candidate = candidate.strip().split()
                    if candidate:
                        self.references.append(candidate[0])

    handle_startendtag = handle_starttag


def check_local_references() -> int:
    failures = 0
    html_files = [*ROOT.glob("*.html"), *sorted((ROOT / "games").glob("*.html"))]
    for page in html_files:
        parser = LocalReferenceParser()
        parser.feed(page.read_text(encoding="utf-8", errors="replace"))
        for reference in parser.references:
            parsed = urlsplit(reference.strip())
            if parsed.scheme or parsed.netloc or not parsed.path or parsed.path.startswith("//"):
                continue
            path = unquote(parsed.path)
            if path.startswith("/api/") or path == "/api":
                continue
            target = (ROOT / path.lstrip("/")) if path.startswith("/") else (page.parent / path)
            target = target.resolve()
            if ROOT not in target.parents and target != ROOT:
                print(f"FAIL: {page.relative_to(ROOT)} escapes the project: {reference}")
                failures += 1
            elif not target.exists():
                print(f"FAIL: {page.relative_to(ROOT)} refers to missing local file: {reference}")
                failures += 1
    return failures


def main() -> int:
    failures = 0
    for relative in (*BUNDLED_ROOT_FILES, *GAME_FILES):
        if not (ROOT / relative).is_file():
            print(f"FAIL: required bundled file is missing: {relative}")
            failures += 1

    index = (ROOT / "index.html").read_text(encoding="utf-8")
    catalog = re.findall(r"\{id:'([^']+)',name:'[^']+',(?:name_en:'[^']+',)?desc:'[^']*',file:'(games/[^']+)'", index)
    catalog_paths = {path for _, path in catalog}
    if len(catalog) != 11:
        print(f"FAIL: expected 11 catalog games, found {len(catalog)}")
        failures += 1
    missing_games = sorted(set(GAME_FILES) - catalog_paths)
    if missing_games:
        print("FAIL: games absent from catalog: " + ", ".join(missing_games))
        failures += 1

    if "VertGamesAndroid?.isNativeApp?.()" not in index:
        print("FAIL: Android guest-play integration is missing")
        failures += 1
    sky_isle = (ROOT / "games/sky-isle.html").read_text(encoding="utf-8", errors="replace")
    if "location.hostname==='appassets.androidplatform.net'" not in sky_isle:
        print("FAIL: Sky-Isle must bypass CDN probing on the packaged app origin")
        failures += 1

    failures += check_local_references()

    for game in GAME_FILES:
        source = (ROOT / game).read_text(encoding="utf-8", errors="replace")
        if 'name="viewport"' not in source and "name='viewport'" not in source:
            print(f"FAIL: missing mobile viewport declaration: {game}")
            failures += 1

    for asset in (ROOT / "assets/redline/meshes.json.gz", ROOT / "assets/redline/surface.json.gz"):
        try:
            json.loads(gzip.decompress(asset.read_bytes()))
        except (OSError, json.JSONDecodeError) as error:
            print(f"FAIL: invalid compressed JSON asset {asset.relative_to(ROOT)}: {error}")
            failures += 1
    for model in (ROOT / "assets/redline/car-pack.glb", ROOT / "assets/redline/gt-r34.glb"):
        if model.read_bytes()[:4] != b"glTF":
            print(f"FAIL: invalid GLB header: {model.relative_to(ROOT)}")
            failures += 1

    if failures:
        print(f"Android web-asset verification FAILED ({failures} issue(s))")
        return 1
    print(f"Android web-asset verification PASS: {len(STATIC_PAGES)} portal pages, {len(GAME_FILES)} games, local links, compressed data, and GLB assets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
