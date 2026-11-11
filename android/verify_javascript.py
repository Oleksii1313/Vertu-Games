#!/usr/bin/env python3
"""Parse bundled and inline JavaScript with Node, without running browser code."""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ScriptParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.scripts: list[tuple[str, str]] = []
        self.current: tuple[str, list[str]] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "script":
            values = dict(attrs)
            self.current = (values.get("type", "").split(";", 1)[0].strip().lower(), [])

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.current[1].append(data)

    def handle_entityref(self, name: str) -> None:
        if self.current is not None:
            self.current[1].append("&" + name + ";")

    def handle_charref(self, name: str) -> None:
        if self.current is not None:
            self.current[1].append("&#" + name + ";")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self.current is not None:
            script_type, chunks = self.current
            self.scripts.append((script_type, "".join(chunks)))
            self.current = None

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)


def main() -> int:
    node = shutil.which("node")
    if not node:
        print("Node.js is required for JavaScript syntax checks.", file=sys.stderr)
        return 2

    checks: list[tuple[str, str, bool]] = []
    for path in sorted([*ROOT.glob("*.js"), *ROOT.glob("games/*.js"),
                        *ROOT.glob("tools/*.js"), *ROOT.glob("tools/*.cjs")]):
        checks.append((path.relative_to(ROOT).as_posix(), path.read_text(encoding="utf-8", errors="replace"),
                       path.suffix == ".mjs"))

    html_files = sorted([*ROOT.glob("*.html"), *ROOT.glob("games/*.html")])
    for page in html_files:
        parser = ScriptParser()
        parser.feed(page.read_text(encoding="utf-8", errors="replace"))
        for index, (script_type, source) in enumerate(parser.scripts):
            if script_type not in ("", "text/javascript", "application/javascript", "module"):
                continue
            if source.strip():
                checks.append((f"{page.relative_to(ROOT).as_posix()} inline script #{index}", source,
                               script_type == "module"))

    failures = []
    with tempfile.TemporaryDirectory(prefix="vertgames-js-check-") as temp:
        for index, (label, source, is_module) in enumerate(checks):
            suffix = ".mjs" if is_module else ".js"
            test_file = Path(temp) / f"script-{index}{suffix}"
            test_file.write_text(source, encoding="utf-8")
            result = subprocess.run([node, "--check", str(test_file)], capture_output=True, text=True)
            if result.returncode:
                failures.append((label, result.stderr.strip()))

    if failures:
        for label, error in failures:
            print(f"FAIL: {label}\n{error}")
        print(f"JavaScript syntax verification FAILED ({len(failures)} issue(s))")
        return 1
    print(f"JavaScript syntax verification PASS: {len(checks)} scripts across {len(html_files)} pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
