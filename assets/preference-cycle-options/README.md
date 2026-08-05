# Preference-cycle sprite options

Nine MINT-style pixel-art alternatives for the Section 01 preference cycle.
Every `-32.png` file is a native 32x32 RGBA master. Every `-128.png` file is
an exact four-times nearest-neighbour export with binary transparency and the
restricted MINT palette used by the site's other strict-grid sprites.

## Installed combination

- A+: `generated-v2/coin-large/coin-large-03-128.png`
- A: `generated-v2/coin-small/coin-small-03-128.png`
- B: `generated-v2/ice-cream/ice-cream-01-128.png`

The source paths can be swapped directly in the three `.cycle-option-sprite`
elements in the microsite's `index.html`.

## Alternatives

### Big coin pile

1. Symmetric stepped pyramid
2. Broad staggered heap
3. Tall central mound with foreground coins

### Two coins

1. Overlapping diagonal coins
2. Shallow two-coin stack
3. Separated offset pair

### Ice cream

1. Broad mint-teal scoop on a cone
2. Cream and blue soft-serve spiral on a cone
3. Two stacked scoops on a cone

See `preference-cycle-options.png` for the complete labelled review sheet.

## Jointly generated sprite-sheet alternatives

`generated-sheet-v2-source.png` contains a second set of nine concepts made in
one 3 x 3 generation so their pixel density, lighting, palette, and proportions
stay consistent. `generated-sheet-v2-transparent.png` is the chroma-keyed source.

The reproducible `split_generated_sheet_v2.py` cleanup step splits the source,
normalizes each subject onto the native 32 x 32 grid, maps it to the restricted
MINT palette, forces binary alpha, and produces exact 128 x 128 nearest-neighbour
exports beneath `generated-v2/`.

See `generated-v2-options.png` for the labelled review sheet. The live diagram
uses option 03 for both coin images and option 01 for the ice cream.
