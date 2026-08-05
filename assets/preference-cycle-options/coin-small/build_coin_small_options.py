"""Build three strict-grid MINT pixel-art options for "a couple of coins".

Each option is authored directly on a transparent 32 x 32 canvas. Production
exports are exact 4x nearest-neighbour enlargements, so every logical pixel is
a uniform 4 x 4 block.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent

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


def coin_face(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    *,
    highlight_right: bool = False,
) -> None:
    """Draw one small round coin with a navy rim and no currency glyph."""
    left, top, right, bottom = box
    draw.ellipse(box, fill=PALETTE["navy"])
    draw.ellipse(
        (left + 1, top + 1, right - 1, bottom - 1),
        fill=PALETTE["orange"],
    )
    draw.ellipse(
        (left + 2, top + 2, right - 2, bottom - 2),
        fill=PALETTE["yellow"],
    )
    highlight_x = right - 3 if highlight_right else left + 2
    draw.point((highlight_x, top + 3), fill=PALETTE["warm_cream"])
    draw.point((highlight_x, top + 4), fill=PALETTE["yellow_light"])
    draw.point((right - 3 if not highlight_right else left + 2, bottom - 3), fill=PALETTE["orange_light"])


def build_option_01() -> Image.Image:
    """Two overlapping medallion faces, diagonally stepped."""
    image, draw = canvas()
    coin_face(draw, (14, 6, 25, 17), highlight_right=True)
    coin_face(draw, (6, 14, 18, 26))
    # One bright join pixel keeps the front coin legible over the rear rim.
    draw.point((17, 16), fill=PALETTE["warm_cream"])
    return image


def draw_stacked_coin(
    draw: ImageDraw.ImageDraw,
    *,
    x: int,
    y: int,
    width: int,
) -> None:
    """Draw one shallow, thick coin in three-quarter view."""
    right = x + width - 1
    draw.polygon(
        [
            (x, y + 3),
            (x + 2, y),
            (right - 2, y),
            (right, y + 3),
            (right, y + 7),
            (right - 2, y + 9),
            (x + 2, y + 9),
            (x, y + 7),
        ],
        fill=PALETTE["navy"],
    )
    draw.rectangle((x + 2, y + 4, right - 2, y + 7), fill=PALETTE["orange"])
    draw.ellipse((x + 1, y + 1, right - 1, y + 6), fill=PALETTE["orange_light"])
    draw.ellipse((x + 2, y + 1, right - 2, y + 5), fill=PALETTE["yellow"])
    draw.rectangle((x + 3, y + 2, x + 6, y + 2), fill=PALETTE["yellow_light"])
    draw.point((x + 3, y + 3), fill=PALETTE["warm_cream"])
    draw.rectangle((x + 3, y + 8, right - 3, y + 8), fill=PALETTE["yellow"])


def build_option_02() -> Image.Image:
    """A short stack with exactly two separately visible layers."""
    image, draw = canvas()
    draw_stacked_coin(draw, x=7, y=14, width=18)
    draw_stacked_coin(draw, x=8, y=7, width=16)
    return image


def build_option_03() -> Image.Image:
    """Two small, separated coin faces in an offset pair."""
    image, draw = canvas()
    coin_face(draw, (6, 14, 15, 23))
    coin_face(draw, (17, 7, 26, 16), highlight_right=True)
    return image


BUILDERS = (build_option_01, build_option_02, build_option_03)


def validate(logical: Image.Image, export: Image.Image, slug: str) -> None:
    if logical.size != (32, 32):
        raise RuntimeError(f"{slug}: logical master is not 32 x 32")
    if export.size != (128, 128):
        raise RuntimeError(f"{slug}: export is not 128 x 128")

    expected = logical.resize((128, 128), Image.Resampling.NEAREST)
    if export.tobytes() != expected.tobytes():
        raise RuntimeError(f"{slug}: export is not an exact nearest-neighbour 4x")

    allowed = {
        tuple(bytes.fromhex(value.lstrip("#"))) + (255,)
        for value in PALETTE.values()
    }
    allowed.add((0, 0, 0, 0))
    colors = set(logical.get_flattened_data())
    unexpected = colors - allowed
    if unexpected:
        raise RuntimeError(f"{slug}: unexpected colors: {sorted(unexpected)}")
    if {color[3] for color in colors} - {0, 255}:
        raise RuntimeError(f"{slug}: alpha is not binary")

    bbox = logical.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError(f"{slug}: sprite is empty")
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    if not 18 <= max(width, height) <= 22:
        raise RuntimeError(f"{slug}: silhouette {width} x {height} is outside 18–22 px")
    if bbox[0] < 1 or bbox[1] < 1 or bbox[2] > 31 or bbox[3] > 31:
        raise RuntimeError(f"{slug}: sprite touches a canvas edge: {bbox}")


def main() -> None:
    for index, builder in enumerate(BUILDERS, start=1):
        slug = f"coin-small-{index:02d}"
        logical = builder()
        export = logical.resize((128, 128), Image.Resampling.NEAREST)
        logical.save(ROOT / f"{slug}-32.png")
        export.save(ROOT / f"{slug}-128.png")
        validate(logical, export, slug)
        bbox = logical.getchannel("A").getbbox()
        print(f"{slug}: validated; alpha bbox={bbox}")


if __name__ == "__main__":
    main()
