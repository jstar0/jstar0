#!/usr/bin/env python3
"""Build the small WOFF2 subsets embedded by the SVG renderer."""

from __future__ import annotations

import json
import re
import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "profile.json"
SOURCE_DIR = ROOT / "src"
OUTPUT_DIR = ROOT / "assets" / "fonts"


def source_font(relative_path: str) -> Path:
    path = ROOT / "node_modules" / relative_path
    if not path.is_file():
        raise SystemExit(f"Missing source font: {path}. Run pnpm install first.")
    return path


def collect_profile_text(value: object, output: list[str]) -> None:
    if isinstance(value, str):
        output.append(value)
    elif isinstance(value, dict):
        for item in value.values():
            collect_profile_text(item, output)
    elif isinstance(value, list):
        for item in value:
            collect_profile_text(item, output)


def collect_source_literals() -> str:
    literals: list[str] = []
    pattern = re.compile(r"(?P<quote>[\"'`])(?P<body>(?:\\.|(?!\1).)*)\1", re.DOTALL)
    for path in SOURCE_DIR.glob("*.ts"):
        source = path.read_text(encoding="utf-8")
        literals.extend(match.group("body") for match in pattern.finditer(source))
    return "".join(literals)


def requested_text() -> str:
    values: list[str] = []
    collect_profile_text(json.loads(DATA_PATH.read_text(encoding="utf-8")), values)
    # Include every printable ASCII glyph used by labels, links and numbers,
    # plus the middle dot used in the generated metric summaries.
    return "".join(values) + collect_source_literals() + "".join(chr(code) for code in range(32, 127)) + "\u00b7"


def build_subset(source_path: Path, output_path: Path, text: str) -> None:
    font = TTFont(source_path)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    font.save(output_path)


def build_global_subsets(output_dir: Path, text: str) -> None:
    build_subset(
        source_font("@fontsource/bodoni-moda/files/bodoni-moda-latin-500-normal.woff2"),
        output_dir / "jstar-display-subset.woff2",
        text,
    )
    build_subset(
        source_font("@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2"),
        output_dir / "jstar-sans-subset.woff2",
        text,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.manifest:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in manifest.items()):
            raise SystemExit("Font subset manifest must map string keys to string text")
        all_text = requested_text()
        build_global_subsets(output_dir, all_text)
        for key, text in manifest.items():
            safe_key = re.fullmatch(r"[A-Za-z0-9._-]+", key)
            if not safe_key:
                raise SystemExit(f"Unsafe font subset key: {key}")
            build_subset(
                source_font("@fontsource/bodoni-moda/files/bodoni-moda-latin-500-normal.woff2"),
                output_dir / f"{key}-display.woff2",
                text,
            )
            build_subset(
                source_font("@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2"),
                output_dir / f"{key}-sans.woff2",
                text,
            )
        print(f"Built global and {len(manifest)} fragment font subsets")
        return

    text = requested_text()
    build_global_subsets(output_dir, text)
    print(f"Built font subsets for {len(set(text))} unique characters")


if __name__ == "__main__":
    main()
