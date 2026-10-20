#!/usr/bin/env python3
"""Contact sheets (UI-01) and the LibreOffice side-by-side (UI-02).

    python3 tests/visual/build_sheets.py --shots artifacts/visual/linux --platform linux
    python3 tests/visual/build_sheets.py --shots DIR --platform windows
    python3 tests/visual/build_sheets.py --libreoffice --shots artifacts/visual/linux

Screenshots are named <fixture>--<view>-<theme>.png (run_ui_linux.py on Linux,
the CI capture scripts on Windows and macOS). One sheet per view and theme
goes to artifacts/visual/sheets/<platform>-<view>-<theme>.png, with each
thumbnail labelled. --libreoffice converts every feature fixture to PDF with
LibreOffice headless, rasterizes the first page with pdftoppm, and puts it
beside LeanDoc's page view (light) in artifacts/visual/side-by-side/, four
fixtures to a sheet. Needs ImageMagick's montage, soffice, and pdftoppm.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FEATURES = ROOT / "tests" / "fixtures" / "features"


def montage(images, labels, output, columns, width):
    output.parent.mkdir(parents=True, exist_ok=True)
    args = ["montage"]
    for image, label in zip(images, labels):
        args += ["-label", label, str(image)]
    args += ["-tile", f"{columns}x", "-geometry", f"{width}x+12+12", "-pointsize", "16",
             "-background", "#d9d6cf", str(output)]
    subprocess.run(args, check=True)
    return output


def contact_sheets(shots: Path, platform: str, out: Path):
    made = []
    for view in ("page", "reading"):
        for theme in ("light", "dark"):
            images = sorted(shots.glob(f"*--{view}-{theme}.png"))
            if not images:
                continue
            labels = [image.name.split("--")[0] for image in images]
            made.append(montage(images, labels, out / "sheets" / f"{platform}-{view}-{theme}.png", 4, 520))
    return made


def libreoffice_side_by_side(shots: Path, out: Path):
    work = Path(tempfile.mkdtemp(prefix="leandoc-lo-"))
    try:
        fixtures = sorted(FEATURES.glob("*.docx"))
        profile = work / "profile"
        subprocess.run(["soffice", f"-env:UserInstallation=file://{profile}", "--headless",
                        "--convert-to", "pdf", "--outdir", str(work), *map(str, fixtures)],
                       check=True, capture_output=True, timeout=600)
        pairs = []
        for fixture in fixtures:
            pdf = work / f"{fixture.stem}.pdf"
            leandoc = shots / f"{fixture.stem}--page-light.png"
            if not pdf.exists() or not leandoc.exists():
                print(f"missing for {fixture.stem}: pdf {pdf.exists()}, screenshot {leandoc.exists()}")
                continue
            prefix = work / f"{fixture.stem}-lo"
            subprocess.run(["pdftoppm", "-png", "-r", "70", "-f", "1", "-l", "1", str(pdf), str(prefix)],
                           check=True)
            page = sorted(work.glob(f"{fixture.stem}-lo*.png"))[0]
            pairs.append((fixture.stem, page, leandoc))
        made = []
        for start in range(0, len(pairs), 4):
            chunk = pairs[start:start + 4]
            images, labels = [], []
            for name, page, leandoc in chunk:
                images += [page, leandoc]
                labels += [f"{name}: LibreOffice", f"{name}: LeanDoc"]
            made.append(montage(images, labels, out / "side-by-side" / f"sheet-{start // 4 + 1}.png", 2, 700))
        return made
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--shots", default=str(ROOT / "artifacts" / "visual" / "linux"))
    parser.add_argument("--platform", default="linux")
    parser.add_argument("--out", default=str(ROOT / "artifacts" / "visual"))
    parser.add_argument("--libreoffice", action="store_true")
    args = parser.parse_args()
    shots, out = Path(args.shots).resolve(), Path(args.out).resolve()
    made = contact_sheets(shots, args.platform, out)
    if args.libreoffice:
        made += libreoffice_side_by_side(shots, out)
    for path in made:
        print(path)
    return 0 if made else 1


if __name__ == "__main__":
    sys.exit(main())
