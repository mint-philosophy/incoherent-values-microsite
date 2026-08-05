"""Build a compact review sheet for the preference-cycle sprite options."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "preference-cycle-options.png"

BACKGROUND = "#101118"
PANEL = "#151621"
BORDER = "#351d4a"
TEXT = "#f4f2e8"
MUTED = "#9aa7b8"
ACCENT = "#48d4b4"

CATEGORIES = (
    ("A+ / BIG COIN PILE", "coin-large", "coin-large"),
    ("A / TWO COINS", "coin-small", "coin-small"),
    ("B / ICE CREAM", "ice-cream", "ice-cream"),
)


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/consolab.ttf" if bold else "C:/Windows/Fonts/consola.ttf"),
        Path("C:/Windows/Fonts/lucon.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def main() -> None:
    canvas = Image.new("RGBA", (840, 710), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    heading = font(22, bold=True)
    body = font(13)
    label = font(15, bold=True)

    draw.text((28, 22), "Preference-cycle pixel-art options", font=heading, fill=TEXT)
    draw.text(
        (28, 55),
        "Native 32px masters shown as exact 4x nearest-neighbour exports",
        font=body,
        fill=MUTED,
    )

    cell_width = 244
    cell_height = 164
    left = 28
    gap = 20

    for row_index, (category, folder, prefix) in enumerate(CATEGORIES):
        row_top = 94 + row_index * 198
        draw.text((left, row_top), category, font=body, fill=ACCENT)

        for option in range(1, 4):
            x = left + (option - 1) * (cell_width + gap)
            y = row_top + 24
            draw.rectangle(
                (x, y, x + cell_width, y + cell_height),
                fill=PANEL,
                outline=BORDER,
                width=1,
            )

            sprite_path = ROOT / folder / f"{prefix}-{option:02d}-128.png"
            if not sprite_path.exists():
                raise FileNotFoundError(sprite_path)
            sprite = Image.open(sprite_path).convert("RGBA")
            if sprite.size != (128, 128):
                raise ValueError(f"Unexpected sprite size: {sprite_path} = {sprite.size}")
            canvas.alpha_composite(sprite, (x + (cell_width - 128) // 2, y + 5))
            draw.text((x + 14, y + 137), f"OPTION {option:02d}", font=label, fill=TEXT)

    draw.text(
        (28, 684),
        "Installed in the diagram: option 01 coin pile / option 01 two coins / option 02 ice cream",
        font=body,
        fill=MUTED,
    )
    canvas.convert("RGB").save(OUTPUT)
    print(OUTPUT)


if __name__ == "__main__":
    main()
