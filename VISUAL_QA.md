# Visual QA - Incoherent Values?

- Date: `2026-08-08` (proportional-composition rework)
- Revision: `main` working tree (uncommitted)
- Browser: headless Google Chrome via Playwright 1.62.1
- Reviewer: `Minty-7c785f5b`

## Viewport, theme, and navigation matrix

The automated suite checks all ten slides in both framed and presentation modes.
Desktop rows include expanded and collapsed sidebars. Mobile rows include the
closed and open drawer, plus a full scroll to its final link.

| CSS viewport | Orientation | Light | Dark | Nav states | No page/slide overflow | Banner/status clear | Complete nav scroll |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| 1440x960 | Desktop | [x] | [x] | [x] | [x] | [x] | [x] |
| 1920x1080 | Desktop | [x] | [x] | [x] | [x] | [x] | [x] |
| 390x844 | Portrait | [x] | [x] | [x] | [x] | [x] | [x] |
| 844x390 | Landscape | [x] | [x] | [x] | [x] | [x] | [x] |

Additional passing viewports: `2560x1080`, `1366x768`, `820x1180`,
`622x800`, `637x800`, `628x633`, `631x543`, `360x640`, and `667x375`.

The deck now composes proportionally: a frame-derived unit (`--u`, container
query based) sizes all type, icons, gutters, sprites, and chart geometry, so
every slide reads at one apparent size at a given window and the fitter is
only a safety net. At composed aspects (ultrawide, full-HD, desktop) every
slide fits at scale `1.0` in both framed and presentation modes; the minimum
fitted scale across the whole matrix is `0.659` in the framed `360x640` case.
The QA script rejects any slide whose measured content escapes the iframe, any
Pretext-managed block with horizontal overflow, any comparison chart that
escapes its visual stack or overlaps the explanatory prose, any collision
among model-chart labels, bars, or values, any fitted-scale spread above
`1.22` (landscape) / `1.45` (portrait) outside declared safety-net windows,
and any two-column text band outside its 26-56% share of frame width.

This pass replaced the fixed-px sizing system with the proportional unit
contract (see `STYLE_GUIDE.md`): measure-bound text columns (the ~60ch measure
wins inside a 26-56% frame-width band), shared top/left datums with a pinned
heading band, em-driven interiors for the preference-cycle and animated
comparison visuals, and a `strict-mono`/ladder/consistency-card geometry that
scales with the unit. deck.js gained bounded retries for empty mid-load
measurements (fonts/images landing between fit passes previously left a stale
fit applied) plus post-`load` settle passes, and the fit diagnostics now name
the elements that set each content-bounds edge. The QA suite measures a
deliberately settled pass and enforces the new proportion gates; its fixed
`22px` typography assertions became unit-uniformity and leading-ratio checks.

Editorial paragraphs share the frame-derived unit size and 1.35 leading on
every slide; the suite verifies that every point and findings row matches the
deck-wide reference size at each viewport. The model-results summary uses
three evenly ruled rows with JetBrains Mono labels; the suite verifies equal
font size, leading, margins, padding, and row spacing in both framed and
presentation modes.

The coherence explanation is tested as four Pretext-managed, evenly ruled rows
with equal type, leading, margins, padding, and visible pixel-art bullets. Its
diagram, heading, and copy must remain collision-free at every viewport.

## Motion and animation matrix

The fixed-comparison animation is tested by controlling its Web Animations API
timeline. Forward states at start, midpoint, and end are compared with the same
states in reverse order. Bounding boxes must remain inside the tier viewport.

| State | Standard motion | Reduced motion | Copy/controls readable | Bounds measured | Alignment verified |
|:---|:---:|:---:|:---:|:---:|:---:|
| Start | [x] | [x] | [x] | [x] | [x] |
| Midpoint/transition | [x] | [x] | [x] | [x] | [x] |
| End | [x] | [x] | [x] | [x] | [x] |
| Reverse: end to midpoint | [x] | [x] | [x] | [x] | [x] |
| Reverse: midpoint to start | [x] | [x] | [x] | [x] | [x] |

Reduced motion preserves the static T4 comparison and removes non-essential
animation without hiding information.

## Interaction and content checks

- [x] The shared MINT banner appears once and is not clipped.
- [x] Sidebar collapse, mobile drawer, local anchors, direct hashes, and frame
  resize messages work.
- [x] Previous/Next buttons, Home/End, arrow/page keys, touch swipes, and Escape
  from presentation mode are wired; arrow navigation is automated with focus in
  both the surrounding shell and the deck iframe.
- [x] A fresh visit starts in light theme in both the shell and deck; switching
  to dark and back updates both surfaces and the remembered preference.
- [x] The external-link runtime exposes nine link instances backed by five
  explicitly approved config entries; every target returned HTTP 200.
- [x] Pretext 0.0.8 loads, waits for fonts, lays out 36 eligible text blocks, and
  emits complete `.pt-line` spans whose text matches each source block; the
  native fallback retains readable content when the module is unavailable. The
  suite also rejects any generated Pretext line that wraps again in the DOM.
- [x] The banner, sidebar, slide frame, controls, charts, and prose were visually
  inspected in representative desktop, portrait-phone (375x812), landscape-phone
  (844x390), small-phone (360x640), and presentation-mode screenshots, in light
  theme throughout and dark theme at desktop.
- [x] Browser console and local network responses have no errors.
- [ ] The publication owner has reviewed the proportional-composition rework.

## Reproduction

```bash
npm install
npm run qa
```

The test starts an isolated local server and does not open an interactive
browser. The manual preview remains available at `http://localhost:8010/`.
