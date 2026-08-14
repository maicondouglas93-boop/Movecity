"""Gera mipmaps Android a partir do ícone específico de cada aplicativo.

Uso:
  python scripts/generate-android-icons.py passenger
  python scripts/generate-android-icons.py driver
  python scripts/generate-android-icons.py all
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]

TARGETS = {
    "passenger": {
        "res": ROOT / "android-passenger" / "app" / "src" / "main" / "res",
        "source": ROOT / "public" / "pwa-icon-512.png",
        "background": (255, 255, 255, 255),
        "background_hex": "#FFFFFF",
    },
    "driver": {
        "res": ROOT / "android" / "app" / "src" / "main" / "res",
        "source": ROOT / "public" / "movecity-driver-icon.png",
        "background": (0, 0, 0, 255),
        "background_hex": "#000000",
    },
}

DENSITIES = [
    ("mipmap-mdpi", 48, 108),
    ("mipmap-hdpi", 72, 162),
    ("mipmap-xhdpi", 96, 216),
    ("mipmap-xxhdpi", 144, 324),
    ("mipmap-xxxhdpi", 192, 432),
]


def fit_logo(logo: Image.Image, size: int, pad_ratio: float = 0.12) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * (1 - 2 * pad_ratio))
    scaled = logo.copy()
    scaled.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    x = (size - scaled.width) // 2
    y = (size - scaled.height) // 2
    canvas.paste(scaled, (x, y), scaled)
    return canvas


def with_bg(img: Image.Image, color: tuple[int, int, int, int]) -> Image.Image:
    bg = Image.new("RGBA", img.size, color)
    bg.alpha_composite(img)
    return bg.convert("RGBA")


def round_mask(img: Image.Image, background: tuple[int, int, int, int]) -> Image.Image:
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    out = with_bg(img, background)
    out.putalpha(mask)
    return out


def generate(
    res: Path,
    logo: Image.Image,
    background: tuple[int, int, int, int],
    background_hex: str,
) -> None:
    for folder, launcher_px, fg_px in DENSITIES:
        out_dir = res / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        with_bg(fit_logo(logo, launcher_px, pad_ratio=0.08), background).save(out_dir / "ic_launcher.png", "PNG")
        round_mask(fit_logo(logo, launcher_px, pad_ratio=0.08), background).save(out_dir / "ic_launcher_round.png", "PNG")
        fit_logo(logo, fg_px, pad_ratio=0.18).save(out_dir / "ic_launcher_foreground.png", "PNG")
        print(f"  {folder}: launcher={launcher_px} fg={fg_px}")

    anydpi = res / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    adaptive = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
"""
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (anydpi / name).write_text(adaptive, encoding="utf-8")

    (res / "values").mkdir(parents=True, exist_ok=True)
    (res / "values" / "ic_launcher_background.xml").write_text(
        f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">{background_hex}</color>
</resources>
""",
        encoding="utf-8",
    )


def main() -> int:
    which = (sys.argv[1] if len(sys.argv) > 1 else "all").lower()
    names = list(TARGETS) if which == "all" else [which]
    if any(n not in TARGETS for n in names):
        print(f"Uso: {sys.argv[0]} [passenger|driver|all]")
        return 1

    for name in names:
        target = TARGETS[name]
        res = target["res"]
        logo = Image.open(target["source"]).convert("RGBA")
        print(f"[{name}] {res}")
        generate(res, logo, target["background"], target["background_hex"])
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
