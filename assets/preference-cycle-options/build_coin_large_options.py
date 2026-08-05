"""Build three strict-grid large-coin-pile options for the preference cycle.

The concepts were explored with image generation, then redrawn directly on a
32x32 logical canvas in the same constrained MINT palette as the site's strict
sprite library. Each 128px asset is an exact 4x nearest-neighbour export.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageColor, ImageDraw


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "coin-large"

PALETTE = {
    "navy": "#1f043d",
    "yellow": "#ced730",
    "yellow_light": "#e8ee66",
    "orange": "#dc691b",
    "orange_light": "#dc7a31",
    "warm_cream": "#fff2b8",
}


def canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def stack(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    width: int,
    height: int,
    *,
    light_side: str = "left",
) -> None:
    """Draw a compact stack of edge-on coins with a one-pixel navy shell."""
    right = x + width - 1
    bottom = y + height - 1
    shell = [
        (x + 1, y),
        (right - 1, y),
        (right, y + 1),
        (right, bottom - 1),
        (right - 1, bottom),
        (x + 1, bottom),
        (x, bottom - 1),
        (x, y + 1),
    ]
    draw.polygon(shell, fill=PALETTE["navy"])
    draw.rectangle((x + 1, y + 1, right - 1, bottom - 1), fill=PALETTE["orange"])
    draw.rectangle((x + 2, y + 1, right - 2, y + 2), fill=PALETTE["yellow_light"])
    draw.line((x + 1, y + 3, right - 1, y + 3), fill=PALETTE["yellow"])
    for band_y in range(y + 5, bottom, 3):
        draw.line((x + 1, band_y, right - 1, band_y), fill=PALETTE["yellow"])
        if band_y + 1 < bottom:
            draw.point((right - 1, band_y + 1), fill=PALETTE["orange_light"])
    highlight_x = x + 2 if light_side == "left" else right - 2
    draw.point((highlight_x, y + 1), fill=PALETTE["warm_cream"])


def face_coin(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    size: int = 8,
    *,
    highlight_side: str = "left",
) -> None:
    """Draw one readable front-facing coin."""
    draw.ellipse((x, y, x + size - 1, y + size - 1), fill=PALETTE["navy"])
    draw.ellipse((x + 1, y + 1, x + size - 2, y + size - 2), fill=PALETTE["orange_light"])
    draw.ellipse((x + 2, y + 2, x + size - 3, y + size - 3), fill=PALETTE["yellow"])
    hx = x + 2 if highlight_side == "left" else x + size - 3
    draw.point((hx, y + 2), fill=PALETTE["warm_cream"])


def build_symmetric_pyramid() -> Image.Image:
    """Option 01: a disciplined, almost architectural stepped pyramid."""
    image, d = canvas()
    # Back-to-front ordering keeps every stack readable while joining the pile.
    stack(d, 13, 5, 7, 8)
    stack(d, 9, 9, 7, 9)
    stack(d, 16, 9, 7, 9, light_side="right")
    stack(d, 5, 14, 8, 10)
    stack(d, 12, 13, 8, 12)
    stack(d, 19, 14, 8, 10, light_side="right")
    stack(d, 4, 20, 8, 7)
    stack(d, 20, 20, 8, 7, light_side="right")
    face_coin(d, 8, 20, 8)
    face_coin(d, 16, 20, 8, highlight_side="right")
    return image


def build_offset_heap() -> Image.Image:
    """Option 02: a broad, low, deliberately staggered mound."""
    image, d = canvas()
    stack(d, 11, 8, 7, 9)
    stack(d, 17, 10, 8, 9, light_side="right")
    stack(d, 6, 11, 8, 11)
    stack(d, 13, 13, 8, 11)
    stack(d, 21, 15, 7, 8, light_side="right")
    stack(d, 4, 18, 8, 8)
    stack(d, 10, 20, 8, 7)
    stack(d, 17, 19, 8, 8, light_side="right")
    # Two visible rims break the rectangular rhythm of the offset stacks.
    face_coin(d, 7, 18, 7)
    face_coin(d, 20, 19, 7, highlight_side="right")
    return image


def build_central_treasure_mound() -> Image.Image:
    """Option 03: a tall centre, lower wings, and two foreground coins."""
    image, d = canvas()
    stack(d, 13, 5, 7, 16)
    stack(d, 7, 11, 8, 13)
    stack(d, 19, 11, 8, 13, light_side="right")
    stack(d, 5, 18, 8, 8)
    stack(d, 21, 18, 7, 8, light_side="right")
    face_coin(d, 8, 19, 9)
    face_coin(d, 17, 19, 9, highlight_side="right")
    # A few attached base coins make the mound feel abundant without clutter.
    stack(d, 5, 23, 7, 5)
    stack(d, 20, 23, 7, 5, light_side="right")
    return image


BUILDERS = {
    "coin-large-01": build_symmetric_pyramid,
    "coin-large-02": build_offset_heap,
    "coin-large-03": build_central_treasure_mound,
}


def save_and_validate(slug: str, logical: Image.Image) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    master_path = OUTPUT / f"{slug}-32.png"
    export_path = OUTPUT / f"{slug}-128.png"
    logical.save(master_path)
    export = logical.resize((128, 128), Image.Resampling.NEAREST)
    export.save(export_path)

    allowed = {ImageColor.getrgb(value) + (255,) for value in PALETTE.values()}
    allowed.add((0, 0, 0, 0))
    colors = set(logical.get_flattened_data())
    unexpected = colors - allowed
    if unexpected:
        raise RuntimeError(f"{slug}: unexpected colors: {unexpected}")
    if {color[3] for color in colors} - {0, 255}:
        raise RuntimeError(f"{slug}: alpha is not binary")
    bbox = logical.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError(f"{slug}: empty sprite")
    if bbox[0] < 1 or bbox[1] < 1 or bbox[2] > 31 or bbox[3] > 31:
        raise RuntimeError(f"{slug}: subject touches the canvas edge: {bbox}")
    if not (20 <= bbox[2] - bbox[0] <= 24 and 16 <= bbox[3] - bbox[1] <= 24):
        raise RuntimeError(f"{slug}: silhouette outside compact target: {bbox}")
    expected = logical.resize((128, 128), Image.Resampling.NEAREST)
    if expected.tobytes() != export.tobytes():
        raise RuntimeError(f"{slug}: export is not exact 4x nearest-neighbour")


def main() -> None:
    for slug, builder in BUILDERS.items():
        save_and_validate(slug, builder())
    print(f"Built and validated {len(BUILDERS)} strict-grid coin-pile options.")


if __name__ == "__main__":
    main()
