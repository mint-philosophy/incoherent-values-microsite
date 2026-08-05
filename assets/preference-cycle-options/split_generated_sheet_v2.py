"""Split and normalize the jointly generated preference-cycle sprite sheet.

The source artwork was generated as one 3 x 3 sheet so the nine concepts share
one visual language. This script crops those concepts, reduces each to the
site's native 32 x 32 logical grid, maps it to the established MINT palette,
forces binary alpha, creates exact 4x nearest-neighbour exports, and builds a
labelled review sheet.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "generated-sheet-v2-transparent.png"
OUTPUT_ROOT = ROOT / "generated-v2"
REVIEW_SHEET = ROOT / "generated-v2-options.png"

SHEET_COLUMNS = (0, 418, 836, 1254)
SHEET_ROWS = (0, 474, 780, 1254)

COIN_PALETTE = (
    "#1f043d",
    "#ced730",
    "#e8ee66",
    "#dc691b",
    "#dc7a31",
    "#fff2b8",
)

ICE_CREAM_PALETTE = (
    "#1f043d",
    "#351d4a",
    "#1992d3",
    "#57c4f2",
    "#46b89d",
    "#48d4b4",
    "#ced730",
    "#e8ee66",
    "#d3343d",
    "#8b4424",
    "#dc691b",
    "#dc7a31",
    "#d7fff3",
    "#fff2b8",
    "#f4f2e8",
)

CATEGORIES = (
    ("coin-large", "A+ / BIG COIN PILE", (24, 23), COIN_PALETTE),
    ("coin-small", "A / TWO COINS", (21, 21), COIN_PALETTE),
    ("ice-cream", "B / ICE CREAM", (18, 22), ICE_CREAM_PALETTE),
)


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def nearest_palette_color(
    pixel: tuple[int, int, int], palette: tuple[tuple[int, int, int], ...]
) -> tuple[int, int, int]:
    return min(
        palette,
        key=lambda candidate: sum(
            (channel - candidate_channel) ** 2
            for channel, candidate_channel in zip(pixel, candidate)
        ),
    )


def normalize_cell(
    cell: Image.Image,
    target_box: tuple[int, int],
    palette_hex: tuple[str, ...],
) -> Image.Image:
    cell = cell.convert("RGBA")
    alpha = cell.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    cell.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError("Generated cell is empty after alpha cleanup")

    subject = cell.crop(bbox)
    max_width, max_height = target_box
    scale = min(max_width / subject.width, max_height / subject.height)
    target_size = (
        max(1, round(subject.width * scale)),
        max(1, round(subject.height * scale)),
    )
    subject = subject.resize(target_size, Image.Resampling.NEAREST)

    allowed = tuple(hex_rgb(value) for value in palette_hex)
    cleaned = Image.new("RGBA", subject.size, (0, 0, 0, 0))
    source_pixels = subject.load()
    output_pixels = cleaned.load()
    for y in range(subject.height):
        for x in range(subject.width):
            red, green, blue, source_alpha = source_pixels[x, y]
            if source_alpha < 128:
                continue
            mapped = nearest_palette_color((red, green, blue), allowed)
            output_pixels[x, y] = (*mapped, 255)

    logical = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    offset = ((32 - cleaned.width) // 2, (32 - cleaned.height) // 2)
    logical.alpha_composite(cleaned, offset)
    return logical


def validate(
    logical: Image.Image,
    export: Image.Image,
    slug: str,
    target_box: tuple[int, int],
    palette_hex: tuple[str, ...],
) -> None:
    if logical.size != (32, 32):
        raise RuntimeError(f"{slug}: logical master is not 32 x 32")
    if export.size != (128, 128):
        raise RuntimeError(f"{slug}: export is not 128 x 128")
    if export.tobytes() != logical.resize((128, 128), Image.Resampling.NEAREST).tobytes():
        raise RuntimeError(f"{slug}: export is not an exact nearest-neighbour 4x")

    allowed = {(*hex_rgb(value), 255) for value in palette_hex}
    allowed.add((0, 0, 0, 0))
    colors = set(logical.get_flattened_data())
    if colors - allowed:
        raise RuntimeError(f"{slug}: pixels escaped the restricted MINT palette")
    if {color[3] for color in colors} - {0, 255}:
        raise RuntimeError(f"{slug}: alpha is not binary")

    bbox = logical.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError(f"{slug}: empty sprite")
    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    if width > target_box[0] or height > target_box[1]:
        raise RuntimeError(f"{slug}: silhouette exceeds target envelope: {bbox}")
    if bbox[0] < 1 or bbox[1] < 1 or bbox[2] > 31 or bbox[3] > 31:
        raise RuntimeError(f"{slug}: sprite touches the logical canvas edge: {bbox}")


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/consolab.ttf" if bold else "C:/Windows/Fonts/consola.ttf"),
        Path("C:/Windows/Fonts/lucon.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def build_review_sheet() -> None:
    background = "#101118"
    panel = "#151621"
    border = "#351d4a"
    text = "#f4f2e8"
    muted = "#9aa7b8"
    accent = "#48d4b4"

    canvas = Image.new("RGBA", (840, 710), background)
    draw = ImageDraw.Draw(canvas)
    draw.text((28, 22), "Jointly generated pixel-art options", font=font(22, bold=True), fill=text)
    draw.text(
        (28, 55),
        "One 3x3 source sheet; split into native 32px MINT-palette masters",
        font=font(13),
        fill=muted,
    )

    cell_width = 244
    cell_height = 164
    left = 28
    gap = 20

    for row_index, (folder, heading, _target_box, _palette) in enumerate(CATEGORIES):
        row_top = 94 + row_index * 198
        draw.text((left, row_top), heading, font=font(13), fill=accent)
        for option in range(1, 4):
            x = left + (option - 1) * (cell_width + gap)
            y = row_top + 24
            draw.rectangle(
                (x, y, x + cell_width, y + cell_height),
                fill=panel,
                outline=border,
                width=1,
            )
            sprite_path = OUTPUT_ROOT / folder / f"{folder}-{option:02d}-128.png"
            sprite = Image.open(sprite_path).convert("RGBA")
            canvas.alpha_composite(sprite, (x + (cell_width - 128) // 2, y + 5))
            draw.text((x + 14, y + 137), f"OPTION {option:02d}", font=font(15, bold=True), fill=text)

    draw.text(
        (28, 684),
        "Installed: option 03 big pile / option 03 two coins / option 01 ice cream.",
        font=font(13),
        fill=muted,
    )
    canvas.convert("RGB").save(REVIEW_SHEET)


def main() -> None:
    sheet = Image.open(SOURCE).convert("RGBA")
    if sheet.size != (1254, 1254):
        raise RuntimeError(f"Unexpected generated sheet size: {sheet.size}")

    built = 0
    for row_index, (folder, _heading, target_box, palette) in enumerate(CATEGORIES):
        output_dir = OUTPUT_ROOT / folder
        output_dir.mkdir(parents=True, exist_ok=True)
        for column_index in range(3):
            cell = sheet.crop(
                (
                    SHEET_COLUMNS[column_index],
                    SHEET_ROWS[row_index],
                    SHEET_COLUMNS[column_index + 1],
                    SHEET_ROWS[row_index + 1],
                )
            )
            logical = normalize_cell(cell, target_box, palette)
            option = column_index + 1
            slug = f"{folder}-{option:02d}"
            master_path = output_dir / f"{slug}-32.png"
            export_path = output_dir / f"{slug}-128.png"
            export = logical.resize((128, 128), Image.Resampling.NEAREST)
            logical.save(master_path)
            export.save(export_path)
            validate(logical, export, slug, target_box, palette)
            bbox = logical.getchannel("A").getbbox()
            print(f"{slug}: validated; alpha bbox={bbox}")
            built += 1

    build_review_sheet()
    print(f"Built and validated {built} sprites plus {REVIEW_SHEET.name}.")


if __name__ == "__main__":
    main()
