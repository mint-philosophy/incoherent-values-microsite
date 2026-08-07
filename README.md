# Incoherent Values? microsite

A static MINT research presentation for **_Incoherent Values? Probing LLM
Preferences Through Parametric Variation_** by Elena Ajayi, Angelica Chowdhury,
and Seth Lazar.

Source of record: [arXiv:2606.21102](https://arxiv.org/abs/2606.21102).

## Editing

The site has no build step. Its files are separated by responsibility so that
content edits do not require changing the responsive frame:

- `deck.html` contains the ten slides. Each top-level `<section>` is one slide.
- `paper.config.json` is the source of truth for the paper title, subtitle,
  authors, and approved external URLs. A URL renders only when
  `approvedForPublication` is exactly `true`.
- `deck.css` and `deck.js` provide responsive slide composition, Pretext line
  layout, viewport fitting, keyboard/touch navigation, and the persistent
  Previous/Next controls.
- `index.html`, `presentation-shell.css`, and `presentation-shell.js` provide the
  MINT frame, local slide outline, search, theme controls, and presentation mode.
- `prototype.css` remains the visual source for Theo's diagrams, charts, colors,
  and type treatment. `prototype.js` is retained as historical implementation
  context but is not loaded by the current site.

To edit wording or visual content, change the relevant section in `deck.html`.
Keep its `id` stable; if a slide is added or renamed, update the `sections` array
in `index.html` as well. Dense material should be split into another slide rather
than made unreadably small. The fitting engine recalculates after fonts, Pretext,
theme, frame, and viewport changes.

The shell and standalone deck default to the light theme. The theme control can
switch to dark, and that explicit choice is remembered in `localStorage` under
`mint-theme` with the `mint-theme-explicit` marker. An absent marker resolves to
light and clears the old automatically stored dark default.

Body prose follows one logical type contract in `deck.css`: Newsreader at a fixed
size and leading, with Pretext responsible for line placement and the slide fitter
responsible for uniform whole-slide scaling. Do not add breakpoint-specific prose
sizes. On the model-results slide, `data-finding-label` supplies the JetBrains Mono
labels for the evenly ruled summary rows.

The MINT banner and global sitemap are loaded from `mintresearch.org`. This repo
keeps a local adaptation of the current presentation shell because the shared
shell JavaScript contains root-relative main-site routes that do not resolve
correctly on the GitHub Pages origin.

## Local preview

From this directory:

```bash
python3 -m http.server 8010
```

Then visit `http://localhost:8010/`.

## Validation

Install the QA dependency once, then run the viewport suite:

```bash
npm install
npm run qa
```

The suite validates the HTML, starts its own local server, and uses headless
Chrome. It checks all ten slides in framed and presentation modes at desktop,
ultrawide, tablet, intermediate portrait, portrait-phone, and landscape-phone
sizes. It also checks Pretext-generated line output, structured links, direct
hashes, Previous/Next and shell/deck keyboard navigation, theme changes,
sidebar/drawer states, reduced motion, animation reversibility, text overflow,
comparison-panel containment, model-results composition, and chart-label
collisions. The model-results checks also reject unequal prose sizing, leading,
padding, margins, or spacing between its summary rows.

See `VISUAL_QA.md` and `PUBLICATION_CHECKLIST.md` for the current review record.

## Deployment

GitHub Pages serves the repository root from `main`; `index.html` is the entry
point. This branch has not been pushed or deployed.
