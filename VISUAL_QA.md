# Visual QA - Incoherent Values?

- Date: `2026-08-07`
- Revision: `codex/responsive-slide-deck` (branch tip)
- Browser: headless Google Chrome via Playwright 1.62.1
- Reviewer: `Minty-3f7a`

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
`622x800`, `637x800`, `628x633`, `360x640`, and `667x375`.

The minimum fitted scale across the matrix is `0.570` in the framed `360x640`
case. All other tested cases fit at a larger scale. The QA script rejects any
slide whose measured content escapes the iframe, any Pretext-managed block with
horizontal overflow, any comparison chart that escapes its visual stack or
overlaps the explanatory prose, and any collision among model-chart labels,
bars, or values.

Editorial paragraphs use one fixed logical Newsreader size and leading across
breakpoints. Pretext places the lines, then the fitter scales the complete slide.
The model-results summary uses three evenly ruled rows with JetBrains Mono labels;
the suite verifies equal font size, leading, margins, padding, and row spacing in
both framed and presentation modes.

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
- [x] The external-link runtime exposes nine link instances backed by five
  explicitly approved config entries; every target returned HTTP 200.
- [x] Pretext 0.0.8 loads, waits for fonts, lays out 31 eligible text blocks, and
  emits complete `.pt-line` spans whose text matches each source block; the
  native fallback retains readable content when the module is unavailable.
- [x] The banner, sidebar, slide frame, controls, charts, and prose were visually
  inspected in representative desktop, portrait-phone, landscape-phone, and
  presentation-mode screenshots.
- [x] Browser console and local network responses have no errors.
- [ ] A publication owner has performed the final visual/content sign-off.

## Reproduction

```bash
npm install
npm run qa
```

The test starts an isolated local server and does not open an interactive
browser. The manual preview remains available at `http://localhost:8010/`.
