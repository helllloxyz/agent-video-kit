#!/usr/bin/env python3
"""Split Regular/Bold CJK serif faces out of installed font collections into .local-deps/fonts/.

The canvas library only exposes the first face of a .ttc (Songti SC: Black), so the video engine loads
CJKSerif-Regular.ttf and CJKSerif-Bold.ttf from .local-deps/fonts/ when they exist. Fonts are used locally
and never committed. Needs fontTools; it is installed into .local-deps/fonttools on first run.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".local-deps" / "fonts"
FONTTOOLS = ROOT / ".local-deps" / "fonttools"
FAMILIES = ["Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif SC", "Source Han Serif CN"]
NAME_HINTS = ("song", "serif", "ming", "simsun")
WEIGHTS = {"Regular": ("Regular",), "Bold": ("Bold",)}


def font_dirs():
    home = Path.home()
    dirs = [
        Path("/System/Library/Fonts"), Path("/Library/Fonts"), home / "Library/Fonts",
        Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), home / ".local/share/fonts", home / ".fonts",
    ]
    if os.name == "nt":
        dirs += [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"]
        if os.environ.get("LOCALAPPDATA"):
            dirs.append(Path(os.environ["LOCALAPPDATA"]) / "Microsoft/Windows/Fonts")
    return [d for d in dirs if d.is_dir()]


def load_fonttools():
    sys.path.insert(0, str(FONTTOOLS))
    try:
        import fontTools  # noqa: F401
    except ImportError:
        print(f"安装 fontTools 到 {FONTTOOLS.relative_to(ROOT)} …", file=sys.stderr)
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--target", str(FONTTOOLS), "fonttools"], check=True)
    from fontTools.ttLib import TTCollection, TTFont
    return TTCollection, TTFont


def faces(path, TTCollection, TTFont):
    try:
        fonts = TTCollection(str(path), lazy=True).fonts if path.suffix.lower() == ".ttc" else [TTFont(str(path), lazy=True)]
    except Exception:
        return
    for font in fonts:
        name = font["name"]
        family = name.getDebugName(16) or name.getDebugName(1)
        sub = name.getDebugName(17) or name.getDebugName(2)
        yield font, family, sub


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--force", action="store_true", help="覆盖已有的 CJKSerif-*.ttf")
    args = ap.parse_args()
    targets = {w: OUT / f"CJKSerif-{w}.ttf" for w in WEIGHTS}
    if not args.force and all(p.exists() for p in targets.values()):
        print(json.dumps({"ok": True, "skipped": True, "files": [str(p) for p in targets.values()]}, ensure_ascii=False))
        return 0
    TTCollection, TTFont = load_fonttools()
    found = {}
    for d in font_dirs():
        for path in sorted(d.rglob("*")):
            if path.suffix.lower() not in (".ttc", ".otf", ".ttf") or not any(h in path.name.lower() for h in NAME_HINTS):
                continue
            for font, family, sub in faces(path, TTCollection, TTFont):
                if family not in FAMILIES:
                    continue
                for weight, subs in WEIGHTS.items():
                    rank = FAMILIES.index(family)
                    if sub in subs and (weight not in found or rank < found[weight][0]):
                        found[weight] = (rank, family, path, font)
    if "Regular" not in found:
        print(json.dumps({"ok": False, "error": f"未找到中文宋体 Regular 字面；请安装 Noto Serif CJK SC 或 Source Han Serif SC（可选：{', '.join(FAMILIES)}）"}, ensure_ascii=False))
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    report = []
    for weight, (_, family, path, font) in found.items():
        font.save(str(targets[weight]))
        report.append({"weight": weight, "family": family, "source": str(path), "file": str(targets[weight])})
    (OUT / "fonts.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "faces": report, "missing": [w for w in WEIGHTS if w not in found]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
