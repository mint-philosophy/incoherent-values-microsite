# Incoherent Values? slide style guide

This file is the required design and implementation contract for the current
deck and any future slides. Read it before editing `deck.html`, `deck.css`, or
the slide-layout code.

## Visual roles

- **JetBrains Mono is structural.** Use it for slide numbers, headings, labels,
  legends, controls, model names, and compact metadata.
- **Newsreader is for reading.** Use it for sentences, explanatory points, and
  other prose. Explanatory rows use one logical size: `22px / 1.35`.
- **Card and chart titles are a named middle tier.** The title of a visual
  (chart headline, statement card) is Newsreader semibold; the apparatus around
  it (disclosure labels, axes, scales, legends) is JetBrains Mono. Do not set a
  visual's title in mono or its axis labels in Newsreader.
- **Do not size prose at breakpoints.** Pretext places lines at the logical type
  size; the fitter scales the complete slide to the visible frame.
- Preserve the existing light-first, restrained MINT palette and square-edged
  diagrams. Pixel art should explain the content, not fill empty space.

## Slide anatomy

Every slide must use the smallest applicable composition:

1. **Title:** title, optional approved subtitle, authors, approved links.
2. **Explainer:** heading, visual if useful, and one `.slide-points` group.
3. **Finding:** heading, `.slide-findings` summary, and the supporting chart.
4. **Structured visual:** heading and a self-contained diagram or repeated row
   system, such as the seven-tier ladder. Do not add bullets to a visual that
   already carries its own labels and icons.

Keep one argument or visual task per slide. Split dense material before making
it unreadably small. Do not use manual `<br>` elements to force line breaks.

Slide headings are left-aligned on every slide, statement slides included. A
multi-part slide declares `data-part`; the chip renders in the header's third
grid column at the right edge — never below the index.

## Explanatory rows

Use this component for every explanatory prose block:

```html
<div class="editorial-copy slide-points">
  <p data-point-icon="compare">Compare each ladder tier with one fixed option.</p>
  <p data-point-icon="trend">The preference should rise with the tier.</p>
</div>
```

Rows have no arbitrary grid gap. Each row has equal vertical padding, a shared
rule, the same Newsreader type, and a `40px` semantic pixel-art marker in a
`56px` gutter. Consecutive rows share one rule. If a diagram interrupts a point
group, the next point begins a new ruled group.

**A ruled row must contain a claim, not a segue.** Transitional one-liners
either merge into the preceding row or are cut; do not spend a rule and a
marker on a sentence whose content the next slide's title already states.

Use the existing `data-point-icon` vocabulary according to meaning. The keys
are finer-grained than the artwork: they resolve to a small set of glyph
families built from the deck's own sprites, and that is intentional — the
bullets are recall anchors for the figures, not one-off illustrations. Do not
hunt for a distinct asset per key or invent new compositions to vary the page:

| Value | Meaning | Glyph family |
|:--|:--|:--|
| `trust`, `measure`, `accurate`, `confirm`, `result`, `paper` | MINT interpretation or conclusion | Minty squid ("the lab speaking") |
| `values`, `order` | What an option is worth | Coins |
| `choice` | A forced pairwise choice | Coin vs ice cream |
| `test`, `cycle`, `finding`, `caution` | Incoherence and its detection | Coins + ice cream trio |
| `ladder`, `sequence`, `trend` | Value-ladder construction or movement | Happiness-tier faces |
| `compare`, `example` | Fixed comparisons or the alligator example | Face and/or alligator |

Reuse or extend this vocabulary only with a semantic reason and an existing,
reviewed asset. Never assign icons randomly to vary the page.

## Findings rows

Quantitative summaries use `.slide-findings`. They share the `22px / 1.35`
Newsreader rhythm and equal ruled rows with `.slide-points`, but use concise
JetBrains Mono `data-finding-label` labels instead of pictorial bullets. Labels
must identify the finding's role, not merely number the lines.

## Pretext contract

- Eligible text-only headings and rows are managed with pinned Pretext `0.0.8`
  through `prepareWithSegments` and `layoutNextLine`.
- Keep point rows text-only when possible so Pretext can manage them. Use Unicode
  characters such as `A⁺` instead of inline markup used only for typography.
- A row that must retain an inline link or semantic emphasis must declare
  `data-pretext-native`; native wrapping is then intentional and testable.
- Generated `.pt-line` spans must stay on one DOM line. The adapter must measure
  the content box, including the effect of icon gutters and borders.
- Never replace Pretext with CSS-only wrapping while claiming Pretext support.

## Responsive contract

- A slide is one visible frame in both the MINT shell and presentation mode.
- The frame's banner, sidebar, status bar, controls, and iframe dimensions all
  count against the available space.
- Prefer intrinsic grid rows for stacked portrait layouts. Never let a child
  escape its declared panel to make the parent appear to fit.
- Fractional (`minmax(0, 1fr)`) rows must never end up smaller than their
  content: a squashed track lets centred children overlap the heading and
  neighbouring panels while the frame check still passes. When content may
  exceed the frame, use intrinsic rows and let the fitter scale the slide.
- Keep Previous/Next buttons, arrow/Page/Home/End keys, touch swipes, direct
  hashes, and presentation-mode hide/restore working at every viewport.

## Content and release contract

- Do not invent visible copy, summaries, claims, venue labels, or links.
- Add external URLs only through publication-approved `paper.config.json` data.
- Run `npm run qa` after every meaningful change. The suite must pass all ten
  slides, both themes, framed and presentation modes, and all recorded viewports.
- Visually inspect the changed slides at the reported problem size and at least
  one desktop, portrait-phone, and landscape-phone viewport.
- Update `VISUAL_QA.md` when the visual contract or viewport matrix changes.
- Do not push or deploy without explicit authorization in the current task.
